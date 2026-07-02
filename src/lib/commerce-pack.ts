// commerce_pack 전용 — 섹션 파싱 + 정책 감사(규칙 기반, AI 호출 없음) + mock 생성기.
// review 페이지(클라이언트)와 /api/posts/[id]/commerce-audit, generate 라우트(서버) 양쪽에서 공유한다.

import type { ProductData, UsageBasis } from '@/types'

export const COMMERCE_SECTION_HEADERS = [
  '블로그 글', '쇼츠 대본', '쇼츠 제작 지시서', '쇼츠 설명란', '릴스 캡션',
  '고정댓글 / CTA', '제휴 고지', '실험 가설', '발행 전 체크리스트',
] as const

export type CommerceSectionHeader = typeof COMMERCE_SECTION_HEADERS[number]

/** "## 제목" 단위로 마크다운을 잘라 섹션명 → 본문 맵을 만든다. 섹션 제목이 없거나 일부만 있어도 안전하게 동작. */
export function splitCommerceSections(markdown: string): Partial<Record<CommerceSectionHeader, string>> {
  const sections: Partial<Record<CommerceSectionHeader, string>> = {}
  let current: CommerceSectionHeader | null = null
  let buf: string[] = []
  for (const line of (markdown ?? '').split('\n')) {
    const m = /^##\s+(.+?)\s*$/.exec(line)
    const heading = m?.[1]?.trim()
    if (heading && (COMMERCE_SECTION_HEADERS as readonly string[]).includes(heading)) {
      if (current) sections[current] = buf.join('\n').trim()
      current = heading as CommerceSectionHeader
      buf = []
    } else if (current) {
      buf.push(line)
    }
  }
  if (current) sections[current] = buf.join('\n').trim()
  return sections
}

// ── 정책 감사 ────────────────────────────────────────────────────────────────

export type AuditSeverity = 'pass' | 'warn' | 'fail'

export interface AuditFinding {
  id: string
  severity: AuditSeverity
  message: string
}

export interface AuditResult {
  overall: AuditSeverity
  findings: AuditFinding[]
}

const DISCLOSURE_PATTERN = /쿠팡\s*파트너스|제휴\s*수수료|제휴\s*링크|제휴\s*고지|#광고/

const FAKE_USAGE_PHRASES = [
  '써보니', '써본 결과', '써봤는데', '써봤더니', '사용해보니', '사용해본 결과', '직접 써봤다', '직접 사용해봤다',
  // 추가 (v3)
  '써봤어요', '써보니까', '받아보니', '사용감이', '실제로 써본', '며칠 써보니', '한 달 써봤', '직접 구매해서',
  // 추가 (v4) — "사용" 단어를 피한 체험담 우회 표현
  '개봉해보니', '언박싱해보니', '뜯어보니', '받자마자', '도착하자마자', '집에서 써', '며칠간 써',
  '일주일 써', '한달 써', '발라보니', '입어보니', '신어보니', '먹어보니', '마셔보니', '손에 잡히는 느낌',
  '제 손에', '제 피부에', '제 머리에', '제 방에 두고', '제가 써', '제가 사용',
  // 추가 (v5) — 검수 브리프 지정 표현 + 진행형/재구매 계열.
  // 오탐 주의: '재구매율'(통계), '사용해보신 분들'(3자 시점)은 잡히면 안 되므로 bare '재구매'/'사용'은 넣지 않는다.
  '사용해봤는데', '사용해봤더니', '실제로 사용', '손이 자주 갔', '재구매 의사', '재구매할', '또 사고 싶',
  '쓰고 있는데', '쓰고 있어요', '사용하고 있어요', '사용하고 있는데', '내돈내산', '애용하',
]

const RISKY_ABSOLUTE_PHRASES = [
  '100%', '무조건', '최저가', '수익 보장', '품절임박', '역대급', '강력추천', '지금 바로',
  // 추가 (v3)
  '효과 확실', '완치', '마감임박', '오늘만', '한정수량', '지금 안 사면',
]

// 입력에 없을 가능성이 높은 '구체적 수치 주장' 패턴 — fail이 아니라 warn(의심)으로만 표시.
const SUSPICIOUS_CLAIM_PATTERNS: { id: string; pattern: RegExp; label: string }[] = [
  { id: 'discount_rate', pattern: /\d{1,3}\s*%\s*(할인|세일|절약)/, label: '할인율 수치' },
  { id: 'revenue_claim', pattern: /(수익|매출)\s*[\d,]+\s*(만원|원|배)/, label: '수익/매출 수치' },
  { id: 'efficacy_claim', pattern: /효능?\s*(이|가)?\s*(입증|보장|검증)/, label: '효능 입증/보장 주장' },
  { id: 'medical_claim', pattern: /(완치|치료\s*효과|질병\s*예방)/, label: '의료효능성 주장' },
]

function firstNonEmptyLine(section: string | undefined): string {
  if (!section) return ''
  return section.split('\n').map((l) => l.trim()).find((l) => l.length > 0) ?? ''
}

/** 섹션 구조와 무관한 본문 텍스트 정책 검사 — commerce_pack·product 감사가 공유. */
function collectTextPolicyFindings(bodyText: string, usageBasis: string | null | undefined): AuditFinding[] {
  const findings: AuditFinding[] = []

  // 사용 안 함인데 1인칭 사용후기 표현
  if (usageBasis && usageBasis !== 'used') {
    const found = FAKE_USAGE_PHRASES.filter((p) => bodyText.includes(p))
    if (found.length) {
      findings.push({
        id: 'fake_usage_claim',
        severity: 'fail',
        message: `직접 사용 안 함(${usageBasis})인데 사용후기 표현이 있습니다: ${found.join(', ')}`,
      })
    }
  }

  // 위험한 절대 표현
  const riskyFound = RISKY_ABSOLUTE_PHRASES.filter((p) => bodyText.includes(p))
  if (riskyFound.length) {
    findings.push({
      id: 'risky_absolute_phrases',
      severity: 'warn',
      message: `과장·강매성 표현이 있습니다: ${riskyFound.join(', ')}`,
    })
  }

  // 입력에 없을 가능성 높은 수치/효능 주장 (의심 — 사람이 직접 대조 확인 필요)
  for (const { id, pattern, label } of SUSPICIOUS_CLAIM_PATTERNS) {
    if (pattern.test(bodyText)) {
      findings.push({
        id: `suspicious_${id}`,
        severity: 'warn',
        message: `${label}으로 의심되는 표현이 있습니다 — 상품 정보에 실제로 있는 수치인지 직접 대조 확인하세요.`,
      })
    }
  }

  return findings
}

function finalizeAudit(findings: AuditFinding[]): AuditResult {
  if (!findings.length) {
    findings.push({ id: 'all_clear', severity: 'pass', message: '규칙 기반 검사에서 발견된 문제가 없습니다. (사람 검수는 별도로 필요)' })
  }
  const overall: AuditSeverity = findings.some((f) => f.severity === 'fail')
    ? 'fail'
    : findings.some((f) => f.severity === 'warn')
    ? 'warn'
    : 'pass'
  return { overall, findings }
}

/**
 * 섹션 없는 단일 글(product 상품 홍보글) 정책 감사. AI 호출 없음.
 * 섹션·고지 위치 검사는 없음 — product 고지는 publish 단계에서 코드가 자동 삽입(appendLegalDisclosureIfNeeded).
 * usageBasis가 'used'가 아니면 1인칭 사용후기 표현을 fail로 잡는다 (기본값 curation 권장).
 */
export function auditPlainPost(bodyText: string, usageBasis: string | null | undefined): AuditResult {
  return finalizeAudit(collectTextPolicyFindings(bodyText, usageBasis))
}

/**
 * commerce_pack 본문을 규칙 기반으로 감사한다. AI 호출 없음 — 정규식/문자열 검사만.
 * usageBasis가 'used'가 아니면 1인칭 사용후기 표현을 fail로 잡는다.
 */
export function auditCommercePack(bodyText: string, usageBasis: string | null | undefined): AuditResult {
  const findings: AuditFinding[] = []
  const sections = splitCommerceSections(bodyText)

  // 1) 필수 섹션 존재 여부
  for (const header of COMMERCE_SECTION_HEADERS) {
    const content = sections[header]
    if (!content) {
      findings.push({ id: `section_missing_${header}`, severity: 'fail', message: `"${header}" 섹션이 없습니다.` })
    } else if (content.length < 5) {
      findings.push({ id: `section_empty_${header}`, severity: 'warn', message: `"${header}" 섹션이 비어있거나 너무 짧습니다.` })
    }
  }

  // 2) 블로그 글 상단 고지
  const blog = sections['블로그 글']
  if (blog) {
    const opening = blog.slice(0, 300)
    if (!DISCLOSURE_PATTERN.test(opening)) {
      findings.push({ id: 'blog_disclosure_top', severity: 'fail', message: '블로그 글 상단(첫 300자)에 제휴 고지 문구가 없습니다.' })
    }
  }

  // 3) 쇼츠 설명란 첫 줄 고지
  const shortsDesc = sections['쇼츠 설명란']
  if (shortsDesc) {
    if (!DISCLOSURE_PATTERN.test(firstNonEmptyLine(shortsDesc))) {
      findings.push({ id: 'shorts_desc_disclosure_top', severity: 'fail', message: '쇼츠 설명란 첫 줄에 제휴 고지가 없습니다.' })
    }
  }

  // 4) 릴스 캡션 첫 줄 #광고/제휴고지
  const reels = sections['릴스 캡션']
  if (reels) {
    if (!DISCLOSURE_PATTERN.test(firstNonEmptyLine(reels))) {
      findings.push({ id: 'reels_caption_disclosure_top', severity: 'fail', message: '릴스 캡션 첫 줄에 #광고 또는 제휴 고지가 없습니다.' })
    }
  }

  // 5~7) 본문 텍스트 정책 검사 (product 감사와 공유)
  findings.push(...collectTextPolicyFindings(bodyText, usageBasis))

  return finalizeAudit(findings)
}

// ── Mock 생성 모드 ───────────────────────────────────────────────────────────
// COMMERCE_PACK_MOCK=1일 때 실제 Claude API를 안 부르고, 입력값 기반으로
// deterministic하게(같은 입력 → 같은 출력) 전체 섹션 본문을 만든다. UI/감사/복사 흐름 테스트용.

/** 발행 전 체크리스트는 항상 마지막에 고정 — 실 출력 포맷과 동일하게 맞춤. */
const MOCK_CHECKLIST = `- [ ] 효능·가격·할인율·수익 등 과장/허위 여부 확인했는가 (mock 모드 — 실제 검토 아님)
- [ ] 쿠팡 파트너스 고지가 블로그·쇼츠설명·릴스캡션 각 상단에 노출되는가
- [ ] 의료효능 등 민감 주장이 없는가
- [ ] 직접 사용하지 않은 상품을 사용후기처럼 쓰지 않았는가
- [ ] 쇼츠 제작 지시서의 자막·B-roll·TTS 지시가 실제 영상에 반영됐는가
- [ ] AI 생성 이미지·가상인물을 썼다면 표시했는가`

export function buildMockCommercePackBody(product: ProductData, usageBasis: UsageBasis): string {
  const item = product.items[0]
  const name = item?.name?.trim() || '상품명 미입력'
  const price = item?.price ? `${item.price.toLocaleString()}원` : '가격 정보 없음'
  const usageLine = usageBasis === 'used'
    ? '직접 써보니 가격 대비 무난했다.'
    : '정보를 찾아보니 가격·구성 위주로 정리할 만한 상품이었다.'

  return `## 블로그 글

# ${name} — 가격·구성만 정리 (mock)

(이 포스팅은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.)

${name}, 가격은 ${price}이다.
${usageLine}

[mock 모드 — 이 본문은 실제 Claude 생성이 아닌 deterministic 더미 출력입니다. COMMERCE_PACK_MOCK=0으로 끄면 실제 생성됩니다.]

## 쇼츠 대본

[0-3초] (쿠팡 파트너스 제휴 고지 포함) ${name} 가격만 빠르게.
[3-8초] ${price}.
[8-12초] 자세한 건 설명란 링크에서 확인하세요.

## 쇼츠 제작 지시서

- 목표: ${name}의 가격·구성을 20초 안에 이해시키기
- 0~3초 후킹: "${name}, 가격만 보고 넘기기 전에 구성부터 확인하세요."
- 장면 구성:
  1. 0~3초: 상품 이미지 + 핵심 질문 자막
  2. 3~10초: 가격/구성 카드
  3. 10~18초: 이런 사람에게 맞음
  4. 18~22초: 설명란 링크 CTA
- 자막 규칙: 한 줄 10~15자, 핵심 단어만 강조
- B-roll/이미지: 상품 이미지 2~3장, 가격/구성 텍스트 카드
- TTS 톤: 빠르지만 차분한 정보 제공자 톤
- 컷 타이밍: 2~4초마다 컷 전환
- 수동 보정: 어색한 자막 줄바꿈은 CapCut에서 직접 수정

## 쇼츠 설명란

(쿠팡 파트너스 활동의 일환으로 일정액의 수수료를 제공받습니다)
${name} 정리. 가격 ${price}. (mock 출력)
#mock #테스트

## 릴스 캡션

#광고 (쿠팡 파트너스 제휴 고지)
${name}
가격 ${price}
(mock 출력)

## 고정댓글 / CTA

1. (정보 강조형) 가격·구성 더 보고 싶으면 링크 확인하세요.
2. (공감형) 비슷한 고민 있으신 분 댓글로 알려주세요.
3. (담백한 행동유도형) 필요하시면 링크에서 확인해보세요.

## 제휴 고지

이 콘텐츠(블로그·쇼츠·릴스 포함)는 쿠팡 파트너스 활동의 일환으로 작성되었으며,
이를 통해 발생하는 구매에 대해 일정액의 수수료를 제공받습니다.

## 실험 가설

가설: mock 모드이므로 실제 가설 검증 대상 아님. UI/정책감사/복사 흐름 테스트 전용.
측정 지표: (해당 없음 — mock)
판단 기준: (해당 없음 — mock)

## 발행 전 체크리스트

${MOCK_CHECKLIST}
- [ ] 이 글은 mock 출력입니다 — 실제 발행 전 반드시 실제 생성으로 교체했는지 확인`
}
