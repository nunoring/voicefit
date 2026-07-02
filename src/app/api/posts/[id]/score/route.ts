import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { askClaudeJSON } from '@/lib/claude'
import { splitCommerceSections } from '@/lib/commerce-pack'
import { getLocalPost, updateLocalPost } from '@/lib/local-posts'
import { getLocalVoiceProfile } from '@/lib/local-voice-profiles'
import { buildVoiceFingerprintRules } from '@/lib/voice-fingerprint'
import { buildVoiceExemplarRules } from '@/lib/voice-exemplars'
import type { VoiceProfile, ScoreApiResult } from '@/types'

const SCORE_SYSTEM = `블로그 본문이 주어진 말투 시스템 프롬프트(글쓰기 지침)와 얼마나 일치하는지 평가하라.

## 점수 기준 (루브릭)
- 90~100: 어미·이모지 타이밍·사진 타이밍·띄어쓰기·줄넘김·문장 리듬이 지침과 거의 완벽히 일치. 읽으면 해당 블로거가 직접 쓴 것 같음.
- 75~89 : 전반적으로 맞지만 1~2개 어미·표현·줄넘김·이모지 타이밍이 지침과 다름. 충분히 자연스러움.
- 60~74 : 말투 방향은 맞으나 어미 일관성, 문단 리듬, 사진/이모지 타이밍 중 일부가 어색함.
- 40~59 : 지침의 핵심 특성(존댓말/반말, 이모지 유무, 줄넘김, 사진 타이밍 등)이 절반 이상 어긋남.
- 0~39  : 지침과 완전히 다른 말투.

## 중요 원칙
- 글의 주제·내용·정보량은 채점하지 말 것. **오직 말투·어체·표현 스타일만** 평가.
- 블로그 포맷 중 줄넘김, 문단 길이, 띄어쓰기, 사진 전후 코멘트 리듬은 말투의 일부이므로 반드시 평가한다.
- 단, 글 유형상 사진이 없는 경우 photo_timing은 감점하지 말고 "미확인"으로 둔다.
- 시그니처 표현은 체크리스트가 아니라 참고 샘플이다. 특정 표현("어모모", "비주얼 미쳤죠" 등)이 빠졌다는 이유만으로 크게 감점하지 말 것.
- 말버릇은 본문 전체에 1~3개만 자연스럽게 섞이면 충분하다. 오히려 과하게 넣으면 AI티로 본다.
- 주소·전화·지도 링크·제휴 고지처럼 코드가 붙이는 정보 헤더는 말투 평가 대상이 아니다.
- 지침에 "~해요" 어미라고 했는데 "~했어요"가 나왔다면 이건 일치로 볼 것 (어미 변형은 자연스러움).
- 사소한 표현 1~2개 차이로 75점 아래로 내리지 말 것.

JSON 필드:
- match_score: 0~100 정수.
- highlights: 어색한 표현/구조 (최대 5개, 실제로 어색한 것만). 각 항목: { text, issue_type("tone"|"formality"|"phrasing"|"emoji"|"layout"), suggestion }
- diagnosis: 전반적 진단 2문장. 잘된 점 1문장 + 개선점 1문장 형식.`

function stripGeneratedHeader(body: string, postType: string | null): string {
  if (postType !== 'review') return body
  const titleIndex = body.search(/^#\s/m)
  return titleIndex > 0 ? body.slice(titleIndex).trim() : body
}

export async function POST(
  _req: NextRequest,
  ctx: RouteContext<'/api/posts/[id]/score'>,
) {
  try {
    const { id } = await ctx.params
    if (id.startsWith('local_post_')) {
      const post = await getLocalPost(id)
      if (!post) {
        return NextResponse.json({ error: '포스트를 찾을 수 없습니다.' }, { status: 404 })
      }
      if (!post.body_text) throw new Error('생성된 본문이 없습니다.')

      const profile = post.voice_profile_id
        ? await getLocalVoiceProfile(post.voice_profile_id)
        : null
      if (!profile) throw new Error('연결된 보이스 프로파일이 없습니다.')

      const voiceRef = `${profile.reusable_system_prompt}${buildVoiceFingerprintRules(profile.profile_json)}${buildVoiceExemplarRules(profile.source_text, profile.profile_json, { postType: post.post_type })}`
      const sectionBody = post.post_type === 'commerce_pack'
        ? (splitCommerceSections(post.body_text)['블로그 글'] || post.body_text)
        : post.body_text
      const bodyForScoring = stripGeneratedHeader(sectionBody, post.post_type)

      const result: ScoreApiResult = (post.post_type === 'commerce_pack' && process.env.COMMERCE_PACK_MOCK === '1')
        ? { match_score: 80, highlights: [], diagnosis: 'mock 모드 — 실제 채점 안 함. COMMERCE_PACK_MOCK=0으로 끄면 실제 채점됩니다.' }
        : await askClaudeJSON<ScoreApiResult>({
          system: SCORE_SYSTEM,
          user: `[말투 글쓰기 지침]\n${voiceRef}\n\n[블로그 본문]\n${bodyForScoring}`,
        })

      await updateLocalPost(id, {
        match_score: result.match_score,
        score_detail_json: {
          highlights: result.highlights,
          diagnosis: result.diagnosis,
        },
        status: 'scored',
      })

      return NextResponse.json(result)
    }

    const supabase = createServerClient()

    const { data: post, error: postErr } = await supabase
      .from('posts')
      .select('body_text, post_type, voice_profiles(profile_json, reusable_system_prompt, source_text)')
      .eq('id', id)
      .single()

    if (postErr) throw new Error(postErr.message)

    const row = post as unknown as {
      body_text: string | null
      post_type: string | null
      voice_profiles: Pick<VoiceProfile, 'profile_json' | 'reusable_system_prompt' | 'source_text'> | null
    }

    if (!row.body_text) throw new Error('생성된 본문이 없습니다.')
    if (!row.voice_profiles) throw new Error('연결된 보이스 프로파일이 없습니다.')

    // 생성에 쓴 기준(reusable_system_prompt)을 그대로 채점 기준으로 사용
    const voiceRef = `${row.voice_profiles.reusable_system_prompt
      || JSON.stringify(row.voice_profiles.profile_json, null, 2)}${buildVoiceFingerprintRules(row.voice_profiles.profile_json)}${buildVoiceExemplarRules(row.voice_profiles.source_text, row.voice_profiles.profile_json, { postType: row.post_type })}`

    // commerce_pack: 멀티섹션 본문 전체가 아니라 "블로그 글" 섹션만 추출해서 채점.
    // 쇼츠 대본·릴스 캡션 등 의도적으로 다른 톤의 섹션이 "말투 불일치"로 오탐되는 걸 방지.
    // 섹션 추출 실패(AI가 헤더를 바꾼 경우 등)엔 전체 본문으로 fallback.
    const sectionBody = row.post_type === 'commerce_pack'
      ? (splitCommerceSections(row.body_text)['블로그 글'] || row.body_text)
      : row.body_text
    const bodyForScoring = stripGeneratedHeader(sectionBody, row.post_type)

    // COMMERCE_PACK_MOCK=1: 채점도 실 API 호출 없이 고정값 반환
    const result: ScoreApiResult = (row.post_type === 'commerce_pack' && process.env.COMMERCE_PACK_MOCK === '1')
      ? { match_score: 80, highlights: [], diagnosis: 'mock 모드 — 실제 채점 안 함. COMMERCE_PACK_MOCK=0으로 끄면 실제 채점됩니다.' }
      : await askClaudeJSON<ScoreApiResult>({
        system: SCORE_SYSTEM,
        user: `[말투 글쓰기 지침]\n${voiceRef}\n\n[블로그 본문]\n${bodyForScoring}`,
      })

    const { error: updateErr } = await supabase
      .from('posts')
      .update({
        match_score: result.match_score,
        score_detail_json: {
          highlights: result.highlights,
          diagnosis: result.diagnosis,
        },
        status: 'scored',
      })
      .eq('id', id)

    if (updateErr) throw new Error(updateErr.message)

    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
