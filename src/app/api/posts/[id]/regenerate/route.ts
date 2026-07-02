import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { askClaude } from '@/lib/claude'
import { ANTI_AI_TONE, COUPANG_REVIEW_COPY, COMMERCE_PACK_RULES } from '@/lib/prompt-rules'
import { buildVoiceFingerprintRules } from '@/lib/voice-fingerprint'
import { buildVoiceExemplarRules } from '@/lib/voice-exemplars'
import { getLocalPost, updateLocalPost } from '@/lib/local-posts'
import { getLocalVoiceProfile } from '@/lib/local-voice-profiles'
import { stripMarkdownHorizontalRules } from '@/lib/generated-text-cleanup'
import type { VoiceProfile, ScoreDetail, Highlight, ProfileJson } from '@/types'

const BLOG_FORMAT_RULES = `

--- 블로그 포맷 규칙 (반드시 지킬 것) ---
- 말투 프로파일의 paragraph_length, line_break_style, spacing_style, photo_timing이 있으면 그 패턴을 최우선으로 따른다.
- 프로파일이 비어 있을 때만 기본값으로 문장 1~2개마다 줄바꿈하고 문단 사이에 빈 줄 1개를 넣는다.
- 말투 프로파일에 "맛집 글/일반 후기에서는 소제목 거의 없음"처럼 글 유형별 예외가 있으면 그 예외를 우선한다.
- 모든 문단을 똑같은 길이로 맞추지 않는다.
- 독자에게 말 걸듯이 쓰되, 원문 특유의 줄넘김과 띄어쓰기 호흡을 보존한다.
- 원문 말투에 가로 구분선이 명확히 있지 않으면 "---" 같은 수평선으로 섹션을 나누지 않는다.

나쁜 예:
"이 제품은 보습력이 뛰어나고 향도 좋으며 피부 자극도 적어서 민감한 피부를
가진 분들도 편하게 쓸 수 있습니다."

좋은 예:
"보습력 진짜 장난 아니에요.
향도 은은하고, 자극도 없어서 민감한 피부도 걱정 없이 쓸 수 있어요! 😊"

이모지·어미·사진 위치·띄어쓰기·줄넘김은 말투 프로파일을 따른다.
------------------------------------------`

const VOICE_FIRST_BLOG_RULES = `

--- 말투 우선 블로그 규칙 ---
목표는 "잘 정돈된 글"보다 "이 사람이 직접 쓴 것 같은 글"이다.
- # 제목 1개만 사용하고, 본문은 메모 순서대로 자연스럽게 흐르게 쓴다.
- 후킹·SEO·정형 구조보다 말버릇, 줄넘김, 붙여쓰기, 문장부호, ㅋㅋ/ㅎㅎ 타이밍을 우선한다.
- 말투 프로파일이 해당 장르에서 소제목을 거의 안 쓴다고 하면 ## 소제목과 "---" 구분선을 쓰지 않는다.
- 정보 헤더나 지도 링크가 붙어도 본문은 정보 문서처럼 정리하지 않는다.
------------------------------------------`

const STYLE_TRANSFER_RULES = `

--- 재생성 목적 ---
이 재생성은 내용을 더 잘 정리하는 작업이 아니라, 사실은 유지하고 말투만 원문 샘플처럼 다시 입히는 작업이다.
- 문단 길이를 들쭉날쭉하게 만든다.
- 붙여쓰기/줄넘김/괄호/ㅋㅋ/ㅎㅎ/!!/?? 타이밍을 원문처럼 살린다.
- 원문 프로필이 이모티콘을 쓰면 글 전체에 1개는 자연스럽게 넣는다. 단 문단마다 넣지 않는다.
- 원문 프로필이 ㅋㅋㅋㅋ, ㅎㅎ, !!, ??를 쓰면 최소 1개는 실제 말투처럼 살린다.
- 정형 소제목, "---" 구분선, 요약형 마무리, 지나치게 깔끔한 정보문 톤은 제거한다.
- "이런 분께 추천", "가격 확인하기", "보러 가기" 같은 정형 광고 문구를 새로 만들지 않는다.
- 정보 설명 문장이 3문단 이상 연속되지 않게, 중간에 짧은 감정 문장이나 혼잣말 문장을 섞는다.
- 초안에 없는 새로운 사실, 가격, 메뉴, 효능, 방문 경험은 추가하지 않는다.
------------------------------------------`

const PRODUCT_REGENERATION_RULES = `

--- 상품글 재생성 규칙 ---
말투 지문이 카피 규칙보다 우선이다. 충돌하면 말투 지문을 따른다.
- 광고 카피처럼 더 세게 팔려고 하지 말고, 기존 사실을 내 블로그 말투로 바꾼다.
- 정형 추천 리스트, 가격확인 CTA, 불편 과장, 효과 확정 표현을 줄인다.
- 직접 사용하지 않은 상품은 사용 후기처럼 쓰지 않는다.
- "정보를 찾아보니", "스펙을 보면", "상세 정보 기준" 같은 간접 출처 표현은 글 전체 1~2회만 쓴다.
- 제목 없이 본문으로 바로 시작하지 말고 # 제목 1개를 유지한다.
------------------------------------------`

function buildSystemPrompt(postType: string | null, reusableSystemPrompt: string, voiceFingerprint: string, voiceExemplars = ''): string {
  const voiceBase = reusableSystemPrompt + voiceFingerprint + voiceExemplars
  if (postType === 'coupang') {
    return voiceBase + ANTI_AI_TONE + COUPANG_REVIEW_COPY
  }
  if (postType === 'daily' || postType === 'review') {
    return voiceBase + VOICE_FIRST_BLOG_RULES + STYLE_TRANSFER_RULES + ANTI_AI_TONE
  }
  if (postType === 'product') {
    return voiceBase + BLOG_FORMAT_RULES + STYLE_TRANSFER_RULES + PRODUCT_REGENERATION_RULES + ANTI_AI_TONE
  }
  if (postType === 'commerce_pack') {
    return voiceBase + BLOG_FORMAT_RULES + STYLE_TRANSFER_RULES + PRODUCT_REGENERATION_RULES + ANTI_AI_TONE + COMMERCE_PACK_RULES
  }
  return voiceBase + BLOG_FORMAT_RULES + ANTI_AI_TONE
}

function buildRegeneratePrompt(
  prevBody: string,
  scoreDetail: ScoreDetail,
  feedback: string,
  postType?: string | null,
): string {
  const highlightLines = scoreDetail.highlights
    .map(
      (h: Highlight) =>
        `  - "${h.text}" (${h.issue_type}) → ${h.suggestion}`,
    )
    .join('\n')

  return `이전에 생성한 블로그 본문을 아래 피드백을 반영해 새로 작성해주세요.

## 이전 본문
${prevBody}

## 점수 진단
${scoreDetail.diagnosis}

## 어색한 표현 수정 제안
${highlightLines || '(없음)'}

${feedback ? `## 추가 피드백\n${feedback}\n` : ''}
${postType === 'commerce_pack' ? `## commerce_pack 구조 보존
- 기존 9개 섹션 제목과 순서를 반드시 유지한다.
- 특히 ## 블로그 글 섹션은 말투를 가장 강하게 바꾸되, 쇼츠/고지/가설/체크리스트 섹션은 구조가 깨지지 않게 최소 수정한다.
` : ''}
위 피드백을 모두 반영해 블로그 본문 전체를 새로 작성하세요. 마크다운 형식을 유지하세요.`
}

export async function POST(
  req: NextRequest,
  ctx: RouteContext<'/api/posts/[id]/regenerate'>,
) {
  try {
    const { id } = await ctx.params
    const { feedback } = (await req.json()) as { feedback?: string }

    if (id.startsWith('local_post_')) {
      const post = await getLocalPost(id)
      if (!post) {
        return NextResponse.json({ error: '포스트를 찾을 수 없습니다.' }, { status: 404 })
      }
      if (!post.body_text) throw new Error('재생성할 본문이 없습니다.')

      const profile = post.voice_profile_id
        ? await getLocalVoiceProfile(post.voice_profile_id)
        : null
      if (!profile) throw new Error('연결된 보이스 프로파일이 없습니다.')

      const scoreDetail: ScoreDetail = post.score_detail_json ?? {
        highlights: [],
        diagnosis: '',
      }
      const voiceFingerprint = buildVoiceFingerprintRules(profile.profile_json)
      const voiceExemplars = buildVoiceExemplarRules(profile.source_text, profile.profile_json, { postType: post.post_type })
      let body_text = (post.post_type === 'commerce_pack' && process.env.COMMERCE_PACK_MOCK === '1')
        ? `${post.body_text}\n\n[mock 재생성 — 실제 API 호출 안 함. feedback: "${feedback || '(없음)'}"]`
        : await askClaude({
          system: buildSystemPrompt(post.post_type, profile.reusable_system_prompt, voiceFingerprint, voiceExemplars),
          user: buildRegeneratePrompt(post.body_text, scoreDetail, feedback ?? '', post.post_type),
        })
      if (post.post_type !== 'commerce_pack') body_text = stripMarkdownHorizontalRules(body_text)

      await updateLocalPost(id, {
        body_text,
        status: 'scored',
        match_score: null,
        score_detail_json: null,
      })

      return NextResponse.json({ body_text, status: 'scored' })
    }

    const supabase = createServerClient()

    const { data: post, error: postErr } = await supabase
      .from('posts')
      .select('body_text, post_type, score_detail_json, voice_profiles(reusable_system_prompt, profile_json, source_text)')
      .eq('id', id)
      .single()

    if (postErr) throw new Error(postErr.message)

    const row = post as unknown as {
      body_text: string | null
      post_type: string | null
      score_detail_json: ScoreDetail | null
      voice_profiles: Pick<VoiceProfile, 'reusable_system_prompt' | 'profile_json' | 'source_text'> | null
    }

    if (!row.body_text) throw new Error('재생성할 본문이 없습니다.')
    if (!row.voice_profiles) throw new Error('연결된 보이스 프로파일이 없습니다.')

    const scoreDetail: ScoreDetail = row.score_detail_json ?? {
      highlights: [],
      diagnosis: '',
    }

    await supabase.from('posts').update({ status: 'generating' }).eq('id', id)
    const voiceFingerprint = buildVoiceFingerprintRules(row.voice_profiles.profile_json as ProfileJson | undefined)
    const voiceExemplars = buildVoiceExemplarRules(row.voice_profiles.source_text, row.voice_profiles.profile_json as ProfileJson | undefined, { postType: row.post_type })

    // COMMERCE_PACK_MOCK=1: 재생성도 실 API 호출 없이 — 이전 본문에 mock 마커만 덧붙인다.
    let body_text = (row.post_type === 'commerce_pack' && process.env.COMMERCE_PACK_MOCK === '1')
      ? `${row.body_text}\n\n[mock 재생성 — 실제 API 호출 안 함. feedback: "${feedback || '(없음)'}"]`
      : await askClaude({
        system: buildSystemPrompt(row.post_type, row.voice_profiles.reusable_system_prompt, voiceFingerprint, voiceExemplars),
        user: buildRegeneratePrompt(row.body_text, scoreDetail, feedback ?? '', row.post_type),
      })
    if (row.post_type !== 'commerce_pack') body_text = stripMarkdownHorizontalRules(body_text)

    const { error: updateErr } = await supabase
      .from('posts')
      .update({ body_text, status: 'scored', match_score: null, score_detail_json: null })
      .eq('id', id)

    if (updateErr) throw new Error(updateErr.message)

    return NextResponse.json({ body_text, status: 'scored' })
  } catch (err) {
    const message = err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
