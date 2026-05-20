import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { askClaudeJSON } from '@/lib/claude'
import type { VoiceProfile, ScoreApiResult } from '@/types'

const SCORE_SYSTEM = `블로그 본문이 주어진 말투 시스템 프롬프트(글쓰기 지침)와 얼마나 일치하는지 평가하라.

## 점수 기준 (루브릭)
- 90~100: 어미·이모지·문장 리듬이 지침과 거의 완벽히 일치. 읽으면 해당 블로거가 직접 쓴 것 같음.
- 75~89 : 전반적으로 맞지만 1~2개 어미나 표현이 지침과 다름. 충분히 자연스러움.
- 60~74 : 말투 방향은 맞으나 어미 일관성이 부족하거나 어색한 표현이 눈에 띔.
- 40~59 : 지침의 핵심 특성(존댓말/반말, 이모지 유무 등)이 절반 이상 어긋남.
- 0~39  : 지침과 완전히 다른 말투.

## 중요 원칙
- 글의 주제·내용·정보량은 채점하지 말 것. **오직 말투·어체·표현 스타일만** 평가.
- 블로그 포맷(줄바꿈, 단락 구조)은 말투와 무관하므로 감점 금지.
- 지침에 "~해요" 어미라고 했는데 "~했어요"가 나왔다면 이건 일치로 볼 것 (어미 변형은 자연스러움).
- 사소한 표현 1~2개 차이로 75점 아래로 내리지 말 것.

JSON 필드:
- match_score: 0~100 정수.
- highlights: 어색한 표현 (최대 5개, 실제로 어색한 것만). 각 항목: { text, issue_type("tone"|"formality"|"phrasing"|"emoji"), suggestion }
- diagnosis: 전반적 진단 2문장. 잘된 점 1문장 + 개선점 1문장 형식.`

export async function POST(
  _req: NextRequest,
  ctx: RouteContext<'/api/posts/[id]/score'>,
) {
  try {
    const { id } = await ctx.params
    const supabase = createServerClient()

    const { data: post, error: postErr } = await supabase
      .from('posts')
      .select('body_text, voice_profiles(profile_json, reusable_system_prompt)')
      .eq('id', id)
      .single()

    if (postErr) throw new Error(postErr.message)

    const row = post as unknown as {
      body_text: string | null
      voice_profiles: Pick<VoiceProfile, 'profile_json' | 'reusable_system_prompt'> | null
    }

    if (!row.body_text) throw new Error('생성된 본문이 없습니다.')
    if (!row.voice_profiles) throw new Error('연결된 보이스 프로파일이 없습니다.')

    // 생성에 쓴 기준(reusable_system_prompt)을 그대로 채점 기준으로 사용
    const voiceRef = row.voice_profiles.reusable_system_prompt
      || JSON.stringify(row.voice_profiles.profile_json, null, 2)

    const result = await askClaudeJSON<ScoreApiResult>({
      system: SCORE_SYSTEM,
      user: `[말투 글쓰기 지침]\n${voiceRef}\n\n[블로그 본문]\n${row.body_text}`,
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
