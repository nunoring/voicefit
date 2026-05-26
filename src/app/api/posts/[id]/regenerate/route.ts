import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { askClaude } from '@/lib/claude'
import { HOOK_RULES, ANTI_AI_TONE, CURATION_COPY } from '@/lib/prompt-rules'
import type { VoiceProfile, ScoreDetail, Highlight } from '@/types'

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
------------------------------------------`

function buildRegeneratePrompt(
  prevBody: string,
  scoreDetail: ScoreDetail,
  feedback: string,
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
위 피드백을 모두 반영해 블로그 본문 전체를 새로 작성하세요. 마크다운 형식을 유지하세요.`
}

export async function POST(
  req: NextRequest,
  ctx: RouteContext<'/api/posts/[id]/regenerate'>,
) {
  try {
    const { id } = await ctx.params
    const { feedback } = (await req.json()) as { feedback?: string }

    const supabase = createServerClient()

    const { data: post, error: postErr } = await supabase
      .from('posts')
      .select('body_text, post_type, score_detail_json, voice_profiles(reusable_system_prompt)')
      .eq('id', id)
      .single()

    if (postErr) throw new Error(postErr.message)

    const row = post as unknown as {
      body_text: string | null
      post_type: string | null
      score_detail_json: ScoreDetail | null
      voice_profiles: Pick<VoiceProfile, 'reusable_system_prompt'> | null
    }

    if (!row.body_text) throw new Error('재생성할 본문이 없습니다.')
    if (!row.voice_profiles) throw new Error('연결된 보이스 프로파일이 없습니다.')

    const scoreDetail: ScoreDetail = row.score_detail_json ?? {
      highlights: [],
      diagnosis: '',
    }

    await supabase.from('posts').update({ status: 'generating' }).eq('id', id)

    const body_text = await askClaude({
      system: row.post_type === 'coupang'
        ? row.voice_profiles.reusable_system_prompt + ANTI_AI_TONE
        : row.voice_profiles.reusable_system_prompt + BLOG_FORMAT_RULES + HOOK_RULES + ANTI_AI_TONE
          + (row.post_type === 'product' ? CURATION_COPY : ''),
      user: buildRegeneratePrompt(row.body_text, scoreDetail, feedback ?? ''),
    })

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
