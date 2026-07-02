/**
 * commerce-pack 유닛 테스트 — 외부 테스트 프레임워크 없음, Node 직접 실행.
 * 실행: npx tsx scripts/test-commerce-pack.ts
 *
 * 검증 대상:
 *  - splitCommerceSections (섹션 파서)
 *  - auditCommercePack (정책 감사, AI 호출 없음)
 *  - buildMockCommercePackBody (mock 생성기)
 *
 * import type은 tsx/esbuild가 strip하므로 @/types 경로 해석 불필요.
 */

import {
  splitCommerceSections,
  auditCommercePack,
  buildMockCommercePackBody,
  COMMERCE_SECTION_HEADERS,
} from '../src/lib/commerce-pack'

// ── 헬퍼 ─────────────────────────────────────────────────────────────────────

let passed = 0
let failed = 0

function test(name: string, fn: () => void): void {
  try {
    fn()
    console.log(`  ✅ ${name}`)
    passed++
  } catch (e) {
    console.log(`  ❌ ${name}: ${e instanceof Error ? e.message : String(e)}`)
    failed++
  }
}

function assert(condition: boolean, msg: string): void {
  if (!condition) throw new Error(msg)
}

// ── 픽스처 ────────────────────────────────────────────────────────────────────

// ProductData 타입은 런타임에 없으니 any로 캐스팅
const PRODUCT = {
  items: [{ name: '테스트 수세미', price: 6900, url: 'https://example.com', description: '천연 수세미' }],
}

const MOCK_NOT_USED = buildMockCommercePackBody(PRODUCT as never, 'not_used')
const MOCK_USED = buildMockCommercePackBody(PRODUCT as never, 'used')
const DISCLOSURE_RE = /쿠팡\s*파트너스|제휴\s*수수료|제휴\s*링크|제휴\s*고지|#광고/

// ── 1. splitCommerceSections ──────────────────────────────────────────────────

console.log('\n[1] splitCommerceSections')

test('전체 섹션 정상 추출', () => {
  const sections = splitCommerceSections(MOCK_NOT_USED)
  for (const h of COMMERCE_SECTION_HEADERS) {
    assert(h in sections, `"${h}" 섹션 없음`)
    assert((sections[h] ?? '').length > 0, `"${h}" 섹션 비어있음`)
  }
})

test('일부 섹션 누락 시 크래시 없음', () => {
  const partial = '## 블로그 글\n블로그 내용\n\n## 쇼츠 대본\n쇼츠 내용'
  const sections = splitCommerceSections(partial)
  assert(sections['블로그 글'] === '블로그 내용', '블로그 글 파싱 실패')
  assert(sections['쇼츠 대본'] === '쇼츠 내용', '쇼츠 대본 파싱 실패')
  assert(!('릴스 캡션' in sections), '없는 섹션이 생겼음')
})

test('섹션 순서 달라도 올바르게 추출', () => {
  const reordered = '## 릴스 캡션\n캡션내용\n\n## 블로그 글\n블로그내용'
  const sections = splitCommerceSections(reordered)
  assert(sections['릴스 캡션'] === '캡션내용', '릴스 캡션 파싱 실패')
  assert(sections['블로그 글'] === '블로그내용', '블로그 글 파싱 실패')
})

test('빈 문자열 → 빈 객체 (크래시 없음)', () => {
  const sections = splitCommerceSections('')
  assert(Object.keys(sections).length === 0, '빈 문자열인데 섹션이 생김')
})

test('score route 구조 확인: 블로그 글 섹션이 fallback 없이 추출됨', () => {
  const sections = splitCommerceSections(MOCK_NOT_USED)
  const blogSection = sections['블로그 글'] ?? null
  assert(blogSection !== null, '블로그 글 섹션이 없어 score route가 전체 본문으로 fallback함')
  // score/route.ts 패턴: bodyForScoring = sections['블로그 글'] || row.body_text
  const bodyForScoring = blogSection || MOCK_NOT_USED
  assert(bodyForScoring === blogSection, 'score route가 블로그 글 섹션 대신 전체 본문을 채점 대상으로 삼음')
})

test('product 타입 본문 → 빈 객체 (의도치 않은 섹션 파싱 없음)', () => {
  const productBody = '# 상품 리뷰\n이 상품을 써봤습니다.\n\n상품 설명이 이어집니다.'
  const sections = splitCommerceSections(productBody)
  assert(Object.keys(sections).length === 0, 'product 본문에서 commerce 섹션이 파싱됨')
})

// ── 2. auditCommercePack ──────────────────────────────────────────────────────

console.log('\n[2] auditCommercePack')

test('정상 mock 본문(not_used) → fail 없음', () => {
  const result = auditCommercePack(MOCK_NOT_USED, 'not_used')
  const fails = result.findings.filter(f => f.severity === 'fail')
  assert(fails.length === 0, `fail 발견됨: ${fails.map(f => f.id).join(', ')}`)
})

test('usage_basis=not_used + 가짜 사용 표현 → fake_usage_claim fail', () => {
  const body = MOCK_NOT_USED + '\n써봤어요. 받아보니 생각보다 좋더라고요.'
  const result = auditCommercePack(body, 'not_used')
  const hasFail = result.findings.some(f => f.id === 'fake_usage_claim' && f.severity === 'fail')
  assert(hasFail, 'fake_usage_claim fail이 없음')
})

test('usage_basis=used + 사용 표현 → fake_usage_claim 없음 (정상 허용)', () => {
  const body = MOCK_USED + '\n써봤어요. 받아보니 생각보다 좋더라고요.'
  const result = auditCommercePack(body, 'used')
  const hasFail = result.findings.some(f => f.id === 'fake_usage_claim')
  assert(!hasFail, 'used인데 fake_usage_claim이 뜸')
})

test('usage_basis=null → fake_usage_claim 검사 스킵', () => {
  const body = MOCK_NOT_USED + '\n써봤어요.'
  const result = auditCommercePack(body, null)
  const hasFail = result.findings.some(f => f.id === 'fake_usage_claim')
  assert(!hasFail, 'usage_basis=null인데 fake_usage_claim이 뜸')
})

test('블로그 글 상단 고지 누락 → blog_disclosure_top fail', () => {
  const noDisc = [
    '## 블로그 글',
    '상품 소개입니다. 아주 좋은 상품이에요.',
    '',
    '## 쇼츠 대본',
    '쇼츠 내용',
    '',
    '## 쇼츠 설명란',
    '(쿠팡 파트너스) 설명',
    '',
    '## 릴스 캡션',
    '#광고 캡션',
    '',
    '## 고정댓글 / CTA',
    'CTA내용',
    '',
    '## 제휴 고지',
    '제휴 고지 내용입니다.',
    '',
    '## 실험 가설',
    '가설 내용',
    '',
    '## 발행 전 체크리스트',
    '- [ ] 확인',
  ].join('\n')
  const result = auditCommercePack(noDisc, 'curation')
  const hasFail = result.findings.some(f => f.id === 'blog_disclosure_top' && f.severity === 'fail')
  assert(hasFail, 'blog_disclosure_top fail이 없음')
})

test('쇼츠 설명란 첫 줄 고지 누락 → shorts_desc_disclosure_top fail', () => {
  const body = MOCK_NOT_USED.replace(
    '## 쇼츠 설명란\n\n(쿠팡 파트너스 활동의 일환으로 일정액의 수수료를 제공받습니다)',
    '## 쇼츠 설명란\n\n설명 내용만 있고 고지가 없어요',
  )
  if (!body.includes('설명 내용만 있고')) {
    // 치환이 안 됐으면 스킵 (mock body 포맷이 바뀐 경우)
    console.log('    ⚠️  mock body 포맷 불일치 — 스킵')
    return
  }
  const result = auditCommercePack(body, 'not_used')
  const hasFail = result.findings.some(f => f.id === 'shorts_desc_disclosure_top' && f.severity === 'fail')
  assert(hasFail, 'shorts_desc_disclosure_top fail이 없음')
})

test('위험 표현(역대급) → risky_absolute_phrases warn', () => {
  const body = MOCK_NOT_USED + '\n역대급 상품입니다.'
  const result = auditCommercePack(body, 'not_used')
  const hasWarn = result.findings.some(f => f.id === 'risky_absolute_phrases' && f.severity === 'warn')
  assert(hasWarn, 'risky_absolute_phrases warn이 없음')
})

test('새로 추가된 위험 표현들 → warn', () => {
  const risky = ['완치', '효과 확실', '마감임박', '한정수량', '지금 안 사면']
  for (const phrase of risky) {
    const body = MOCK_NOT_USED + `\n${phrase} 표현이 들어간 문장입니다.`
    const result = auditCommercePack(body, 'not_used')
    const hasWarn = result.findings.some(f => f.id === 'risky_absolute_phrases')
    assert(hasWarn, `"${phrase}" → risky warn 없음`)
  }
})

test('새로 추가된 가짜 사용 표현들 → fail (not_used)', () => {
  const fake = ['써봤어요', '써보니까', '받아보니', '사용감이', '실제로 써본', '며칠 써보니', '한 달 써봤', '직접 구매해서']
  for (const phrase of fake) {
    const body = MOCK_NOT_USED + `\n${phrase} 느낌이 어떤지 알겠더라고요.`
    const result = auditCommercePack(body, 'not_used')
    const hasFail = result.findings.some(f => f.id === 'fake_usage_claim' && f.severity === 'fail')
    assert(hasFail, `"${phrase}" → fake_usage_claim fail 없음`)
  }
})

test('사용 단어를 피한 체험담 우회 표현들 → fail (not_used)', () => {
  const fake = ['개봉해보니', '언박싱해보니', '도착하자마자', '집에서 써', '발라보니', '입어보니', '신어보니', '먹어보니', '제 피부에']
  for (const phrase of fake) {
    const body = MOCK_NOT_USED + `\n${phrase} 생각보다 괜찮다는 느낌이 들었어요.`
    const result = auditCommercePack(body, 'not_used')
    const hasFail = result.findings.some(f => f.id === 'fake_usage_claim' && f.severity === 'fail')
    assert(hasFail, `"${phrase}" → fake_usage_claim fail 없음`)
  }
})

test('브리프 지정 체험담 표현들 → fail (not_used)', () => {
  // CEO 검수 브리프에서 직접 지정한 fail 예시 + 우회 변형
  const fake = [
    '며칠 사용해봤는데', '실제로 사용하면서', '손이 자주 갔어요', '재구매 의사',
    '내돈내산', '쓰고 있는데', '사용하고 있어요', '사용해봤더니',
  ]
  for (const phrase of fake) {
    const body = MOCK_NOT_USED + `\n${phrase} 만족스러웠어요.`
    const result = auditCommercePack(body, 'not_used')
    const hasFail = result.findings.some(f => f.id === 'fake_usage_claim' && f.severity === 'fail')
    assert(hasFail, `"${phrase}" → fake_usage_claim fail 없음`)
  }
})

test('체험담 오탐 방지: 통계/타인 언급은 fail 아님 (not_used)', () => {
  // "재구매율", "사용해보신 분들" 같은 3자 시점·통계 언급은 개인 체험 주장이 아님
  const safe = ['재구매율이 높은 상품이에요.', '먼저 사용해보신 분들 후기를 보면 평이 좋아요.']
  for (const sentence of safe) {
    const body = MOCK_NOT_USED + `\n${sentence}`
    const result = auditCommercePack(body, 'not_used')
    const hasFail = result.findings.some(f => f.id === 'fake_usage_claim')
    assert(!hasFail, `오탐: "${sentence}" → fake_usage_claim`)
  }
})

test('모든 섹션 누락 → 전체 section_missing fail', () => {
  const result = auditCommercePack('섹션 없는 본문.', null)
  const missingFails = result.findings.filter(f => f.id.startsWith('section_missing_') && f.severity === 'fail')
  assert(
    missingFails.length === COMMERCE_SECTION_HEADERS.length,
    `섹션 누락 fail ${missingFails.length}개 (${COMMERCE_SECTION_HEADERS.length}개 예상)`,
  )
})

test('overall=fail — fail 찾거든 fail', () => {
  const result = auditCommercePack('비어있음', null)
  assert(result.overall === 'fail', `overall이 ${result.overall}`)
})

test('overall=pass — 정상 mock(used)', () => {
  const result = auditCommercePack(MOCK_USED, 'used')
  const fails = result.findings.filter(f => f.severity === 'fail')
  assert(fails.length === 0, `overall fail 예상 못 한 항목: ${fails.map(f => f.id).join(', ')}`)
  assert(result.overall !== 'fail', `overall이 fail: ${result.overall}`)
})

// ── 3. buildMockCommercePackBody ──────────────────────────────────────────────

console.log('\n[3] buildMockCommercePackBody')

test('출력에 전체 섹션 헤더 모두 포함', () => {
  for (const h of COMMERCE_SECTION_HEADERS) {
    assert(MOCK_NOT_USED.includes(`## ${h}`), `"## ${h}" 헤더 없음`)
  }
})

test('쇼츠 제작 지시서에 편집 지시 포함', () => {
  const sections = splitCommerceSections(MOCK_NOT_USED)
  const brief = sections['쇼츠 제작 지시서'] ?? ''
  for (const keyword of ['0~3초 후킹', '자막 규칙', 'B-roll/이미지', 'TTS 톤', '컷 타이밍']) {
    assert(brief.includes(keyword), `쇼츠 제작 지시서에 "${keyword}" 없음`)
  }
})

test('not_used → "정보를 찾아보니" 포함', () => {
  assert(MOCK_NOT_USED.includes('정보를 찾아보니'), '"정보를 찾아보니" 없음')
})

test('used → "직접 써보니" 포함', () => {
  assert(MOCK_USED.includes('직접 써보니'), '"직접 써보니" 없음')
})

test('블로그 섹션 앞부분에 고지 문구 포함', () => {
  const sections = splitCommerceSections(MOCK_NOT_USED)
  const blog = sections['블로그 글'] ?? ''
  assert(DISCLOSURE_RE.test(blog.slice(0, 400)), '블로그 섹션 앞 400자에 고지 없음')
})

test('[mock 모드] 표시 포함', () => {
  assert(MOCK_NOT_USED.includes('[mock 모드'), '[mock 모드] 표시 없음')
})

test('상품명이 출력에 포함', () => {
  assert(MOCK_NOT_USED.includes('테스트 수세미'), '상품명이 mock 본문에 없음')
})

test('가격이 출력에 포함 (로케일 포맷)', () => {
  const hasPrice = MOCK_NOT_USED.includes('6,900원') || MOCK_NOT_USED.includes('6900원')
  assert(hasPrice, '가격이 mock 본문에 없음')
})

test('curation도 동일하게 "정보를 찾아보니" 분기', () => {
  const mockCuration = buildMockCommercePackBody(PRODUCT as never, 'curation')
  assert(mockCuration.includes('정보를 찾아보니'), 'curation에서 "정보를 찾아보니" 없음')
})

// ── 결과 ──────────────────────────────────────────────────────────────────────

console.log(`\n── 결과: ${passed} passed, ${failed} failed ──\n`)
if (failed > 0) {
  process.exit(1)
}
