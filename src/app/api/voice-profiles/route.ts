import { NextRequest, NextResponse } from 'next/server'
import { askClaudeJSON, askClaude } from '@/lib/claude'
import { createServerClient } from '@/lib/supabase'
import type { ProfileJson, VoiceProfile, VoiceProfileCreateResponse } from '@/types'

const ANALYSIS_SYSTEM = `다음 글에서 글쓴이의 말투와 글쓰기 스타일을 분석해 JSON으로 추출하라.
필드: tone, formality, avg_sentence_length, sentence_endings(배열), signature_phrases(배열), emoji_usage, emoji_position, photo_timing, paragraph_length, spacing_style, heading_usage, vocabulary_notes, do_list(배열), dont_list(배열).

각 필드의 타입을 반드시 지킬 것:
- tone, formality, emoji_usage, vocabulary_notes는 단일 문자열(string).
  절대 객체로 만들지 말 것. 분류·세부 항목이 있어도 한 문자열로 압축할 것.
  예) emoji_usage는 '가끔', '음식 관련 글에서 자주' 같은 문자열. {casual, food_related} 같은 객체 금지.
- emoji_position: 이모지를 어디에 주로 쓰는지. 예: '문단 끝에', '강조할 때만', '거의 안 씀', '문장 중간'
- photo_timing: 사진을 언제 삽입하는지 패턴. 예: '3~4문단마다 1장', '소제목 직후', '글 초반 집중', '거의 없음'
- paragraph_length: 문단 길이 패턴. 예: '짧게 끊어쓰기(2~3줄)', '보통(4~6줄)', '길게 서술형(7줄+)'
- spacing_style: 띄어쓰기 스타일. 예: '표준 맞춤법', '블로그식(붙여쓰기 혼용)', '혼용'
- heading_usage: 소제목 사용 패턴. 예: '자주 씀(H2 중심)', '가끔 씀', '거의 안 씀'
- photo_comment_style: 사진을 올릴 때 어떤 식으로 글을 이어가는지. 사진 바로 앞/뒤 문장의 표현 패턴.
  예: '사진 보시는 것처럼~', '고기 때깔 봐요 진짜ㅋㅋ', '이거 보고 안 시킬 수가 없잖아요', '(사진만 올리고 별도 코멘트 없음)'
  없으면 null.
- sentence_endings, signature_phrases, do_list, dont_list는 문자열 배열(string[]).
  각 원소도 단일 문자열. 객체 금지.
- avg_sentence_length는 정수(number).
- signature_phrases 주의: "이상 ~이었습니다", "이상 [블로거닉네임]이었습니다" 같이 특정 블로거 이름/닉네임이 포함된 서명 표현은 제외할 것.
  서명 표현 자체가 아니라, 해당 블로거의 일반적인 말버릇·어투·표현 패턴만 추출.
추가 필드를 만들거나 필드 안에 새로운 객체 구조를 임의로 도입하지 말 것.`

const PROMPT_GEN_SYSTEM = `주어진 말투 분석 JSON을 보고, 이 글쓴이의 말투를 그대로 재현하기 위한 system 프롬프트를 한국어로 작성하라.
결과물은 다른 글을 쓸 때 system 프롬프트로 바로 붙여넣을 수 있는 지침 형태여야 한다.
분석 JSON을 나열하지 말고, 글쓰기 지침 문장으로 재해석해 작성하라.

반드시 포함할 내용:
1. 어체/말투 (존댓말/반말, 어미 패턴)
2. paragraph_length 가 있으면 → "문단은 X줄로 짧게 끊어 쓸 것" 또는 "길게 이어서 쓸 것" 등 명시
3. spacing_style 이 있으면 → 블로그식 띄어쓰기 습관 명시
4. photo_comment_style 이 있으면 → "사진 주변 문장은 이런 톤으로: [예시]" 형태로 포함
   단, 예시 문구에 특정 가게 이름이나 고유명사가 들어가지 않게 일반화할 것
5. signature_phrases 에서 특정 가게 이름·닉네임이 포함된 서명은 제외하고, 일반 표현만 포함`

// ── 정규화 헬퍼 ───────────────────────────────────────────────────────────────

function flattenToString(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value === null || value === undefined) return ''
  if (Array.isArray(value)) return value.map(flattenToString).join(', ')
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => `${k}: ${flattenToString(v)}`)
      .join(', ')
  }
  return JSON.stringify(value)
}

function normalizeArray(val: unknown): string[] {
  if (!Array.isArray(val)) return []
  return val.map(flattenToString)
}

/**
 * 모델이 스키마를 어기고 객체를 반환해도 안전하게 ProfileJson으로 정규화.
 * - 문자열 필드에 객체가 들어오면 "key: value" 형태로 펼쳐 문자열로 변환
 * - 배열 필드가 아니면 []로 강제, 원소 객체도 문자열로 변환
 * - 9개 필드 외 추가 필드는 버림
 */
export function normalizeProfileJson(raw: unknown): ProfileJson {
  const r = (raw ?? {}) as Record<string, unknown>
  return {
    tone:               flattenToString(r.tone),
    formality:          flattenToString(r.formality),
    avg_sentence_length: isNaN(Number(r.avg_sentence_length)) ? 0 : Number(r.avg_sentence_length),
    sentence_endings:   normalizeArray(r.sentence_endings),
    signature_phrases:  normalizeArray(r.signature_phrases),
    emoji_usage:        flattenToString(r.emoji_usage),
    emoji_position:     flattenToString(r.emoji_position) || undefined,
    photo_timing:       flattenToString(r.photo_timing) || undefined,
    paragraph_length:   flattenToString(r.paragraph_length) || undefined,
    spacing_style:      flattenToString(r.spacing_style) || undefined,
    heading_usage:         flattenToString(r.heading_usage) || undefined,
    photo_comment_style:   flattenToString(r.photo_comment_style) || undefined,
    vocabulary_notes:      flattenToString(r.vocabulary_notes),
    do_list:            normalizeArray(r.do_list),
    dont_list:          normalizeArray(r.dont_list),
  }
}

// ── 라우트 핸들러 ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { name, source_text } = body as { name?: string; source_text?: string }

    if (!name?.trim()) {
      return NextResponse.json({ error: 'name은 필수입니다.' }, { status: 400 })
    }
    if (!source_text?.trim() || source_text.trim().length < 50) {
      return NextResponse.json(
        { error: 'source_text는 50자 이상이어야 합니다.' },
        { status: 400 },
      )
    }

    // 1. 말투 분석 → 정규화
    const raw = await askClaudeJSON<unknown>({
      system: ANALYSIS_SYSTEM,
      user: source_text,
    })
    const profile_json = normalizeProfileJson(raw)

    // 2. 정규화된 profile_json 기반으로 system 프롬프트 생성
    const reusable_system_prompt = await askClaude({
      system: PROMPT_GEN_SYSTEM,
      user: JSON.stringify(profile_json, null, 2),
    })

    // 3. DB insert
    const supabase = createServerClient()
    const { data, error } = await supabase
      .from('voice_profiles')
      .insert({
        name: name.trim(),
        source_text,
        profile_json: profile_json as unknown as Record<string, unknown>,
        reusable_system_prompt,
      })
      .select('id, profile_json, reusable_system_prompt')
      .single()

    if (error) throw new Error(error.message)

    const response: VoiceProfileCreateResponse = {
      id: (data as unknown as { id: string }).id,
      profile_json: (data as unknown as { profile_json: ProfileJson }).profile_json,
      reusable_system_prompt: (data as unknown as { reusable_system_prompt: string }).reusable_system_prompt,
    }

    return NextResponse.json(response, { status: 201 })
  } catch (err) {
    const message = err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function GET() {
  try {
    const supabase = createServerClient()
    const { data, error } = await supabase
      .from('voice_profiles')
      .select('id, name, created_at, profile_json')
      .order('created_at', { ascending: false })

    if (error) throw new Error(error.message)

    return NextResponse.json(data as unknown as Pick<VoiceProfile, 'id' | 'name' | 'created_at' | 'profile_json'>[])
  } catch (err) {
    const message = err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
