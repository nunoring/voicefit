import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { askClaude } from '@/lib/claude'
import { buildPlaceContext, fetchNaverImages, searchPlace } from '@/lib/naver-search'
import { askClaudeVision } from '@/lib/claude'
import type { ImageMediaType } from '@/lib/claude'
import type { VoiceProfile, PostType, ProductData, PostImage, ProfileJson } from '@/types'

const BLOG_FORMAT_RULES = `

--- 중요: 시스템 프롬프트 지침 보호 ---
이 시스템 프롬프트에 포함된 지침 문장, 예시 문구, 설명 텍스트를 절대 본문에 그대로 쓰지 말 것.
지침은 글쓰기 방향을 안내하는 것일 뿐, 본문 내용이 아니다.
예) "사진 뒤에 오는 문장은 ~같아요", "photo_comment_style" 같은 표현이 본문에 나타나면 절대 안 됨.
------------------------------------------

--- 글 맺음 규칙 ---
블로거 서명/마무리 표현("이상 ~이었습니다", "~이었습니다" 류)은 반드시 글의 맨 마지막 문장으로만 사용.
서명 표현 뒤에 다른 문장이 이어지면 안 됨.
------------------------------------------

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

--- 톤 가드레일 ---
이 글은 개인 블로그 포스팅이다. 광고·홍보물도 아니고, 혹평 리뷰도 아니다.
전체적으로 **긍정적이되 솔직한 톤**을 유지할 것.

금지 표현:
- "지금 바로 구매하세요", "한정 수량", "강력 추천", "무조건"
- 과도한 부정: 아쉬운 점은 1개 정도면 충분. 전체 절반 이상을 단점으로 채우지 말 것
- "이 제품이", "제품명", "구매" 등 상품 리뷰 전용 표현 (음식점/경험 글에서)

반드시 지킬 것:
- 경험한 것 위주로 써서 읽는 사람이 공감할 수 있게
- 아쉬운 점이 있어도 전체 분위기는 "그래도 괜찮았다" 방향으로 마무리
- 마무리는 재방문 의향이나 추천 여부로 자연스럽게
------------------------------------------`

const ANTI_HALLUCINATION = `
--- 절대 지켜야 할 사실 원칙 ---
최우선: 사용자가 직접 쓴 경험 메모만이 사실의 근거다.
네이버 검색 결과는 보조 참고용일 뿐이며, 메모 내용과 충돌하면 메모를 따른다.

금지 사항:
- 메모에 없는 구체적 사실 지어내기 금지 (메뉴, 가격, 인테리어, 직원, 효능 등)
- 장소 이름만 보고 장르/업종을 멋대로 판단 금지
  예) "목구멍"이라는 이름을 보고 목건강 클리닉이라고 단정하지 말 것 — 고기집일 수 있음
- 검색 결과가 메모와 다르면 메모 우선. 검색 결과는 "~로 알려져 있어요" 톤으로만
- 쿠팡 파트너스, 구매 링크, 상품 구매 유도 문구 금지
- "이 제품이", "이 제품을", "제품명", "구매하다", "구매 링크" 등 상품 리뷰 전용 표현 금지
  → 음식점/경험 리뷰라면 "이 집이", "여기가", "이 곳이" 등으로 표현할 것
------------------------------------------`

// 이미지 타입 분류 (vision_interpretation 기반)
function classifyImageType(interpretation: string | null): string {
  if (!interpretation) return '사진'
  const t = interpretation
  if (/외관|건물|입구|간판|전경/.test(t)) return '외관'
  if (/내부|인테리어|홀|테이블|좌석|공간/.test(t)) return '내부'
  if (/메뉴판|메뉴|가격표/.test(t)) return '메뉴판'
  if (/고기|음식|요리|반찬|구워|삼겹|갈비|스테이크|생선|밥|국|찌개|라면|피자|파스타|케이크|커피|음료/.test(t)) return '음식'
  return '사진'
}

// AI에게 넘길 이미지 슬롯 텍스트 (경쟁사 방식 채택)
function buildImageSlotsText(images: PostImage[]): string {
  if (!images.length) return '이미지 없음 — 이미지 플레이스홀더 삽입 금지.'

  const slots = images.map((img, i) => {
    const type = classifyImageType(img.vision_interpretation)
    const desc = img.vision_interpretation
      ? img.vision_interpretation.split(/[.。]/)[0].trim()
      : `사진 ${i + 1}`
    return `- <사진${i + 1}_${type}>: ${desc}`
  })

  return `아래 사진들을 글 흐름에 맞게 자연스럽게 배치하세요.
각 플레이스홀더(<사진N_타입>)는 해당 내용이 언급되는 문단 바로 뒤에 단독 라인으로 삽입.
사진 앞뒤 문장에서 해당 사진 내용을 자연스럽게 언급할 것.
모든 사진 반드시 포함.

${slots.join('\n')}`
}

// <사진N_타입> → ![image-N] 변환
function resolveImageSlots(bodyText: string, images: PostImage[]): string {
  // AI가 슬롯을 쓴 경우 변환
  const resolved = bodyText.replace(/<사진(\d+)_[^>]*>/g, (_, n) => {
    const idx = parseInt(n, 10) - 1
    return idx >= 0 && idx < images.length ? `![image-${n}]` : ''
  })

  // 슬롯을 하나도 안 쓴 경우 → 기존 균등 배치 폴백
  const hasMarkers = /!\[image-\d+\]/.test(resolved)
  if (!hasMarkers && images.length) {
    return injectMarkersEqually(resolved, images)
  }
  return resolved
}

// 폴백: 균등 간격 삽입
function injectMarkersEqually(bodyText: string, images: PostImage[]): string {
  const paras = bodyText.split(/\n{2,}/).filter(Boolean)
  if (!paras.length) return bodyText
  const total = paras.length
  const result: string[] = []
  images.forEach((_, i) => {
    const pos = Math.min(total - 1, Math.round((i + 1) * total / (images.length + 1)) - 1)
    paras[pos] = paras[pos] + `\n\n![image-${i + 1}]`
  })
  return paras.join('\n\n')
}

// 구조 가이드 (heading_usage 기반 조건부)
function buildStructureGuide(headingUsage?: string): string {
  const useHeadings = headingUsage && /자주|H2|소제목/.test(headingUsage)
  if (useHeadings) {
    return `
글 구조 (소제목 포함):
1. # 제목 (지역명/업체명 + 핵심 특징)
2. 도입부: 방문 계기, 첫인상
3. ## 매장 분위기: 위치, 인테리어, 접근성
4. ## 음식 리뷰: 맛, 식감, 비주얼
5. ## 이 집만의 포인트
6. 마무리: 총평, 재방문 의사`
  }
  return `
글 구조 (소제목 없이 자연스럽게):
1. # 제목 (지역명/업체명 + 핵심 특징 한 줄)
2. 도입부: 방문 계기
3. 매장 분위기 + 음식 리뷰를 자연스럽게
4. 아쉬운 점 간략히
5. 마무리: 총평`
}

function buildDailyPrompt(dailyContent: string, images: PostImage[]): string {
  return `## 오늘의 일상 메모
${dailyContent}

## 사진
${buildImageSlotsText(images)}

## 요구사항
- 마크다운 형식, 최소 600자
- 메모를 그대로 옮기지 말고 독자에게 말 걸듯 풀어낼 것
- # 제목 포함
- 광고나 홍보 문구 절대 금지
${ANTI_HALLUCINATION}`
}

function buildReviewPrompt(
  place: string,
  experience: string,
  placeContext = '',
  images: PostImage[] = [],
  headingUsage?: string,
  placeLink?: string,
): string {
  const structure = buildStructureGuide(headingUsage)
  const imageSection = buildImageSlotsText(images)
  const linkSection = placeLink ? `\n\n마무리 끝에 다음 줄 추가:\n📍 네이버 플레이스: ${placeLink}` : ''

  return `## 방문한 장소
${place}

## 내 경험 메모 (최우선 — 이게 글의 핵심)
${experience}${placeContext}

## 사진
${imageSection}
${structure}

## 요구사항
- 마크다운 형식, 최소 700자
- 직접 방문한 생생한 후기 톤
- 좋았던 점 위주, 아쉬운 점 1개 정도만
- 검색 정보는 "~로 알려져 있어요" 톤으로만
- 과장 표현 금지${linkSection}
${ANTI_HALLUCINATION}`
}

function buildUserPrompt(product: ProductData, images: PostImage[]): string {
  const itemsText = product.items
    .map(
      (item, i) =>
        `상품 ${i + 1}:\n  이름: ${item.name}${item.price ? `\n  가격: ${item.price.toLocaleString()}원` : ''}${item.url ? `\n  URL: ${item.url}` : ''}${item.description ? `\n  설명: ${item.description}` : ''}`,
    )
    .join('\n\n')

  return `## 상품 정보\n${itemsText}

## 사진
${buildImageSlotsText(images)}

## 요구사항
- 마크다운 형식, 최소 800자
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
      post_type: PostType | null
      product_data_json: ProductData | null
      content_json: { daily_content?: string; review_place?: string; review_experience?: string } | null
      voice_profiles: Pick<VoiceProfile, 'reusable_system_prompt' | 'profile_json'> | null
    }
    const profileJson = row.voice_profiles?.profile_json as ProfileJson | undefined

    if (!row.voice_profiles) throw new Error('연결된 보이스 프로파일이 없습니다.')

    const postType = row.post_type ?? 'product'

    await supabase.from('posts').update({ status: 'generating' }).eq('id', id)

    // 이미지 조회 헬퍼
    async function queryImages(): Promise<PostImage[]> {
      const { data } = await supabase
        .from('post_images').select('*').eq('post_id', id)
        .order('placement_index', { ascending: true })
        .order('created_at', { ascending: true })
      return (data ?? []) as unknown as PostImage[]
    }

    let finalImages = await queryImages()
    let userPrompt: string

    if (postType === 'daily') {
      const dailyContent = row.content_json?.daily_content ?? ''
      if (!dailyContent.trim()) throw new Error('일상 기록 내용이 없습니다.')
      userPrompt = buildDailyPrompt(dailyContent, finalImages)

    } else if (postType === 'review') {
      const place = row.content_json?.review_place ?? ''
      const experience = row.content_json?.review_experience ?? ''
      if (!place.trim()) throw new Error('장소 정보가 없습니다.')

      // 플레이스 검색
      const placeResult = await searchPlace(place)

      // 이미지 소싱 (직접 올린 게 없을 때)
      if (!finalImages.length) {
        // 1순위: 네이버 플레이스 방문자 사진 (최대 5장)
        const candidateUrls: string[] = [
          ...placeResult.placePhotos,                     // 플레이스 방문자 사진
          ...(await fetchNaverImages(place, 5)),           // 부족하면 웹 검색으로 보충
        ].slice(0, 5)

        let idx = 0
        for (const imageUrl of candidateUrls) {
          if (idx >= 5) break
          try {
            const imgRes = await fetch(imageUrl, {
              signal: AbortSignal.timeout(8000),
              headers: { 'Referer': 'https://map.naver.com/' },
            })
            if (!imgRes.ok) continue
            const contentType = imgRes.headers.get('content-type') ?? 'image/jpeg'
            if (!contentType.startsWith('image/')) continue
            const buffer = await imgRes.arrayBuffer()
            if (buffer.byteLength < 5000) continue  // 너무 작은 이미지(오류 페이지 등) 건너뜀
            const ext = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg'
            const storagePath = `${id}/place_${Date.now()}_${idx}.${ext}`
            const { error: upErr } = await supabase.storage
              .from('post-images').upload(storagePath, buffer, { contentType, upsert: false })
            if (upErr) continue
            const { data: { publicUrl } } = supabase.storage.from('post-images').getPublicUrl(storagePath)

            // vision 분석 — 실제로 뭔 사진인지 파악
            let visionInterpretation: string | null = null
            let placementIndex: number | null = null
            try {
              const base64 = Buffer.from(buffer).toString('base64')
              const mediaType = (contentType as ImageMediaType)
              const visionResult = await askClaudeVision({
                system: '이 사진이 무엇을 찍은 것인지 한 문장으로 설명하라. 예: "가게 외관", "카페 내부 좌석", "음식 사진 — 커피와 케이크". 한국어로.',
                user: '이 사진을 한 문장으로 설명해줘.',
                imageBase64: base64,
                mediaType,
              })
              visionInterpretation = visionResult.trim()
              // placement: 외관/간판 → 도입부(0), 음식/메뉴 → 중반(1), 내부/루프탑 → 후반(2)
              placementIndex = /외관|간판|전경|입구|건물/.test(visionInterpretation) ? 0
                : /음식|메뉴|커피|케이크|디저트/.test(visionInterpretation) ? 1
                : 1
            } catch { /* vision 실패해도 계속 */ }

            await supabase.from('post_images').insert({
              post_id: id, source_type: 'official',
              storage_path: storagePath, public_url: publicUrl,
              placement_index: placementIndex ?? idx,
              vision_interpretation: visionInterpretation,
            })
            idx++
          } catch { /* 계속 */ }
        }
        finalImages = await queryImages()
      }

      // 플레이스 컨텍스트 + 링크
      const placeContext = await buildPlaceContext(place)
      const placeLink = placeResult.placeId
        ? `https://m.place.naver.com/place/${placeResult.placeId}`
        : undefined

      userPrompt = buildReviewPrompt(
        place, experience, placeContext, finalImages,
        profileJson?.heading_usage, placeLink,
      )

    } else {
      if (!row.product_data_json?.items?.length) throw new Error('상품 데이터가 없습니다.')
      userPrompt = buildUserPrompt(row.product_data_json, finalImages)
    }

    const rawText = await askClaude({
      system: row.voice_profiles.reusable_system_prompt + BLOG_FORMAT_RULES,
      user: userPrompt,
    })
    // AI가 삽입한 <사진N_타입> 슬롯 → ![image-N] 변환
    const body_text = resolveImageSlots(rawText, finalImages)

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
