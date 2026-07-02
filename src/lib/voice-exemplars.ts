import type { ProfileJson } from '@/types'

function cleanExcerpt(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/!\[[^\]]*]\([^)]*\)/g, '')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim()
}

type ExemplarOptions = {
  maxCount?: number
  postType?: string | null
}

function genreScore(text: string, postType?: string | null): number {
  if (postType === 'review') {
    let score = 0
    if (/위치|가게|카페|자리|입구|건물|밖에|지하|점심|먹|맛|마제|소바|웨이팅|들어가|찾아가/.test(text)) score += 5
    if (/제품|클렌저|피부|블랙헤드|충전|실리콘|사용법|장점|단점|광고 제품|방수/.test(text)) score -= 5
    return score
  }
  if (postType === 'product' || postType === 'commerce_pack' || postType === 'coupang') {
    let score = 0
    if (/제품|사용|장점|단점|총평|광고 제품|실용성|구매|충전|방수|피부|클렌저/.test(text)) score += 4
    if (/위치|가게|카페|점심|마제|소바|웨이팅/.test(text)) score -= 3
    return score
  }
  return 0
}

function scoreExcerpt(text: string, profile?: ProfileJson, postType?: string | null): number {
  let score = 0
  if (/[ㅋㅎ]{2,}|!!|\?\?|[😊😮😂🤣👍💡📍⭐]/.test(text)) score += 3
  if (text.includes('\n')) score += 2
  if (/\S+\.\S+/.test(text)) score += 2 // 블로그식 붙여쓰기: "했어요.근데"
  if (text.split('\n').some((line) => line.trim().length > 0 && line.trim().length < 24)) score += 1
  score += genreScore(text, postType)

  for (const phrase of profile?.signature_phrases ?? []) {
    if (phrase && text.includes(phrase)) score += 2
  }
  for (const habit of profile?.do_list ?? []) {
    const firstToken = habit.split(/[ ,·/()]/).find(Boolean)
    if (firstToken && text.includes(firstToken)) score += 1
  }
  if (/목차|업체명|가격표|쿠팡 파트너스|제휴 링크/.test(text)) score -= 2
  return score
}

export function extractVoiceExcerpts(
  sourceText: string | null | undefined,
  profile?: ProfileJson,
  options: ExemplarOptions = {},
): string[] {
  if (!sourceText?.trim()) return []
  const maxCount = options.maxCount ?? 3

  const normalized = sourceText.replace(/\r\n/g, '\n')
  const blocks = normalized
    .split(/\n{2,}/)
    .map(cleanExcerpt)
    .filter((block) => block.length >= 60 && block.length <= 650)

  const candidates = blocks.length
    ? blocks
    : normalized
      .split(/(?<=[.!?。！？])\s+/)
      .map(cleanExcerpt)
      .filter((block) => block.length >= 60 && block.length <= 650)

  return candidates
    .map((text, index) => ({ text, index, score: scoreExcerpt(text, profile, options.postType) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, maxCount)
    .map(({ text }) => text)
}

export function buildVoiceExemplarRules(
  sourceText: string | null | undefined,
  profile?: ProfileJson,
  options: ExemplarOptions = {},
): string {
  const excerpts = extractVoiceExcerpts(sourceText, profile, options)
  if (!excerpts.length) return ''

  return `

--- 원문 말투 샘플 (few-shot, AI티 방지 최상위 참고) ---
아래 샘플은 내용이 아니라 표면 습관을 복제하기 위한 자료다.
복제할 것: 줄넘김 간격, 문단 길이 들쭉날쭉함, 붙여쓰기/띄어쓰기 습관, 이모티콘 위치, ㅋㅋ/ㅎㅎ 타이밍, 느낌표/물음표/괄호 사용, 사진 전후 말투.
복사 금지: 샘플의 장소명, 상품명, 가격, 고유명사, 사실관계, 문장 자체.
새 글은 사용자 메모의 사실만 사용하되, 아래 샘플과 같은 호흡으로 쓴다.

${excerpts.map((excerpt, i) => `[샘플 ${i + 1}]\n${excerpt}`).join('\n\n')}
------------------------------------------`
}
