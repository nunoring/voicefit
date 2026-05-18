import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { askClaude } from '@/lib/claude'
import type { VoiceProfile, ProductData, PostImage } from '@/types'

const BLOG_FORMAT_RULES = `

--- 블로그 포맷 규칙 (반드시 지킬 것) ---
- 문장 1~2개마다 줄바꿈한다.
- 강조하고 싶은 내용은 단독 한 줄로 띄운다.
- 문단과 문단 사이에는 빈 줄을 1개 넣는다.
- 한 문단은 최대 3~4줄을 넘기지 않는다.
- 독자에게 말 걸듯이 짧게 끊어 쓴다. 한 문장에 정보를 몰아넣지 않는다.

나쁜 예:
"이 제품은 보습력이 뛰어나고 향도 좋으며 피부 자극도 적어서 민감한 피부를
가진 분들도 편하게 쓸 수 있습니다."

좋은 예:
"보습력 진짜 장난 아니에요.
향도 은은하고, 자극도 없어서 민감한 피부도 걱정 없이 쓸 수 있어요! 😊"

이모지·어미 등은 말투 프로파일을 따르고, 위 줄바꿈/문단 구조 규칙은 말투와 무관하게 항상 적용한다.
------------------------------------------

--- 이미지 삽입 규칙 (IMAGES 섹션이 있을 때 반드시 지킬 것) ---
- IMAGES 목록에 N개의 이미지가 주어지면, 본문에 ![image-1] … ![image-N] 마커를
  정확히 N개, 각 1번씩 삽입한다.
- 마커는 단독 라인으로 둔다. 마커 앞뒤로 빈 줄을 넣는다.
- 마커 누락·중복·번호 건너뜀 금지. 번호는 반드시 1부터 N까지 순서대로.
- 이미지가 0개이면 마커를 절대 넣지 말 것.
------------------------------------------

--- 광고 톤 가드레일 (절대 어기지 말 것) ---
이 글은 개인 블로그 포스팅이다. 광고·홍보물이 아니다.

금지 표현 (이 중 하나라도 쓰면 안 됨):
- "지금 바로 구매하세요", "지금 사세요", "서두르세요", "한정 수량"
- "최고의", "No.1", "업계 1위", "혁신적인", "기적의", "완벽한"
- "절대 후회 없습니다", "강력 추천", "무조건 사야 해"
- 제품명을 한 문단에 3회 이상 반복
- 효능·효과에 대한 과장 주장 ("즉각 효과", "100% 개선")

반드시 지킬 것:
- 단점이나 아쉬운 점을 최소 1개 이상 솔직하게 언급할 것
- "내가 직접 써봤더니", "개인적으로는" 같은 경험 시점 유지
- 마무리는 구매 강요가 아닌 독자 판단에 맡기는 톤으로
- 가격 언급 시 "합리적이다/비싸다" 등 주관적 의견 포함
------------------------------------------`

function buildUserPrompt(product: ProductData, images: PostImage[]): string {
  const itemsText = product.items
    .map(
      (item, i) =>
        `상품 ${i + 1}:\n  이름: ${item.name}${item.price ? `\n  가격: ${item.price.toLocaleString()}원` : ''}${item.url ? `\n  URL: ${item.url}` : ''}${item.description ? `\n  설명: ${item.description}` : ''}`,
    )
    .join('\n\n')

  // 이미지는 배열 순서 = 마커 번호. placement_index 값 자체는 사용하지 않음.
  const imagesSection = images.length
    ? `\n\n## IMAGES — 총 ${images.length}개 (전부 본문에 삽입 필수)\n` +
      images
        .map((img, i) => {
          const n = i + 1
          const desc = img.vision_interpretation
            ?? `${img.source_type} 이미지 (${img.public_url.split('/').pop()?.slice(0, 40) ?? ''})`
          const para = img.generated_paragraph ? `\n  추천 단락: ${img.generated_paragraph}` : ''
          return `이미지 ${n}: ${desc}${para}\n  → 본문에 삽입 시 반드시 ![image-${n}] 형식 그대로 사용`
        })
        .join('\n\n') +
      `\n\n규칙: 각 이미지 마커(![image-1]~![image-${images.length}])를 ` +
      `빈 줄로 감싼 단독 라인에 정확히 삽입. 마커 외 다른 텍스트를 같은 줄에 쓰지 말 것.`
    : '\n\n## IMAGES\n  이미지 없음 — 마커 절대 삽입 금지.'

  return `## 상품 정보\n${itemsText}${imagesSection}

## 요구사항
- 마크다운 형식으로 작성
- 최소 800자 이상의 자연스러운 블로그 포스팅
- 상품 특징과 장점을 독자 시점에서 자연스럽게 녹여낼 것
- 마지막 단락에 구매 유도 문구 포함`
}

export async function POST(
  _req: NextRequest,
  ctx: RouteContext<'/api/posts/[id]/generate'>,
) {
  try {
    const { id } = await ctx.params
    const supabase = createServerClient()

    const { data: post, error: postErr } = await supabase
      .from('posts')
      .select('*, voice_profiles(reusable_system_prompt, profile_json)')
      .eq('id', id)
      .single()

    if (postErr) throw new Error(postErr.message)

    const row = post as unknown as {
      product_data_json: ProductData | null
      voice_profiles: Pick<VoiceProfile, 'reusable_system_prompt' | 'profile_json'> | null
    }

    if (!row.voice_profiles) throw new Error('연결된 보이스 프로파일이 없습니다.')
    if (!row.product_data_json?.items?.length) throw new Error('상품 데이터가 없습니다.')

    // 이미지: placement_index 오름차순 → created_at 오름차순 (배열 순서 = 마커 번호)
    const { data: images } = await supabase
      .from('post_images')
      .select('*')
      .eq('post_id', id)
      .order('placement_index', { ascending: true })
      .order('created_at', { ascending: true })

    await supabase.from('posts').update({ status: 'generating' }).eq('id', id)

    const body_text = await askClaude({
      system: row.voice_profiles.reusable_system_prompt + BLOG_FORMAT_RULES,
      user: buildUserPrompt(row.product_data_json, (images ?? []) as unknown as PostImage[]),
    })

    const { error: updateErr } = await supabase
      .from('posts')
      .update({ body_text, status: 'scored' })
      .eq('id', id)

    if (updateErr) throw new Error(updateErr.message)

    return NextResponse.json({ body_text, status: 'scored' })
  } catch (err) {
    const message = err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
