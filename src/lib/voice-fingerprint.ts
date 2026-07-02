import type { ProfileJson } from '@/types'

export function buildVoiceFingerprintRules(profile?: ProfileJson): string {
  if (!profile) return ''
  const aiRisks = profile.ai_tell_risks?.length
    ? profile.ai_tell_risks.join(', ')
    : '균일한 문단, 일반론 문장, 광고 카피 같은 CTA'
  const signaturePhrases = profile.signature_phrases?.length
    ? profile.signature_phrases.join(', ')
    : '원문에 반복되는 말버릇'
  const doList = profile.do_list?.length
    ? profile.do_list.join(', ')
    : '원문에서 자주 보이는 리듬'
  const dontList = profile.dont_list?.length
    ? profile.dont_list.join(', ')
    : '원문에서 잘 쓰지 않는 표현'

  return `

--- 말투 지문 잠금 규칙 (AI티 방지 최우선) ---
아래 항목은 콘텐츠 정보보다 우선하는 스타일 지문이다. 새 글에서도 이 리듬을 유지한다.
- 말버릇/시그니처 표현: ${signaturePhrases}
- 이모지 사용량: ${profile.emoji_usage || '원문 기준'}
- 이모지 위치: ${profile.emoji_position || '원문 기준'}
- 이모지 타이밍: ${profile.emoji_timing || '원문 기준'}
- 사진 삽입 타이밍: ${profile.photo_timing || '글 흐름상 필요한 지점'}
- 사진 주변 코멘트: ${profile.photo_comment_style || '사진마다 똑같이 설명하지 말 것'}
- 문단 길이: ${profile.paragraph_length || '원문 기준'}
- 줄넘김 방식: ${profile.line_break_style || '원문 기준'}
- 띄어쓰기 방식: ${profile.spacing_style || '표준 한국어 기준, 과교정 금지'}
- 소제목 사용: ${profile.heading_usage || '원문 기준'}
- 문장부호/ㅋㅋ/ㅎㅎ 습관: ${profile.punctuation_style || '과장 없이 원문 기준'}
- AI티 위험 요소: ${aiRisks}
- 반드시 살릴 습관: ${doList}
- 피해야 할 습관: ${dontList}

금지:
- 모든 문단을 같은 길이로 맞추지 말 것.
- 소제목 사용 규칙에 글 유형별 예외가 있으면 예외를 우선할 것. 예: "맛집 글에서는 소제목 거의 없음"이면 맛집/방문 후기에서 ## 소제목을 만들지 말 것.
- 사진마다 같은 형식의 코멘트를 반복하지 말 것.
- 이모지를 넣으라는 이유만으로 문단마다 넣지 말 것.
- 말버릇을 한 문단에 몰아넣지 말 것. 본문 전체에 2~4개만 자연스럽게 흩뿌릴 것.
- 맞춤법을 고치더라도 원문 특유의 블로그식 호흡과 줄넘김을 없애지 말 것.
------------------------------------------`
}
