/**
 * publish-gate 유닛 테스트 — 외부 테스트 프레임워크 없음, Node 직접 실행.
 * 실행: npm run test:publish
 *
 * 검증 대상:
 *  - checkPublishGate (말투 점수 게이트 D-022 / 채널 분리 D-012 / 정책 감사 디스패치)
 *  - auditPlainPost (product 평문 감사)
 */

import { checkPublishGate, VOICE_SCORE_PASS } from '../src/lib/publish-gate'
import { auditPlainPost, buildMockCommercePackBody } from '../src/lib/commerce-pack'

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

const PRODUCT = { items: [{ name: '테스트 수세미', price: 6900 }] }
const COMMERCE_BODY = buildMockCommercePackBody(PRODUCT as never, 'not_used')
const PLAIN_BODY = '# 상품 소개\n\n정보를 찾아보니 구성이 괜찮은 상품이었어요.\n스펙 기준으로 정리해봅니다.'

// ── 1. 말투 점수 게이트 (D-022) ────────────────────────────────────────────────

console.log('\n[1] 말투 점수 게이트')

test('match_score=null(미채점) → 422 차단', () => {
  const r = checkPublishGate({ post_type: 'review', body_text: '본문', match_score: null })
  assert(!r.ok && r.status === 422, `차단 안 됨: ${JSON.stringify(r)}`)
})

test('match_score=74 → 422 차단', () => {
  const r = checkPublishGate({ post_type: 'review', body_text: '본문', match_score: VOICE_SCORE_PASS - 1 })
  assert(!r.ok && r.status === 422, `차단 안 됨: ${JSON.stringify(r)}`)
})

test('match_score=75 → 통과', () => {
  const r = checkPublishGate({ post_type: 'review', body_text: '본문', match_score: VOICE_SCORE_PASS })
  assert(r.ok, `통과 못 함: ${JSON.stringify(r)}`)
})

test('본문 없음 → 400', () => {
  const r = checkPublishGate({ post_type: 'review', body_text: null, match_score: 90 })
  assert(!r.ok && r.status === 400, `400 아님: ${JSON.stringify(r)}`)
})

// ── 2. 채널 분리 게이트 (D-012) ────────────────────────────────────────────────

console.log('\n[2] 채널 분리 게이트 (네이버 ↔ 쿠팡 링크)')

test('네이버 발행 + 쿠팡 링크 → 422 차단', () => {
  const body = '후기 본문\nhttps://link.coupang.com/a/abc123 여기서 확인'
  const r = checkPublishGate({ post_type: 'review', body_text: body, match_score: 90, platform: 'naver' })
  assert(!r.ok && r.status === 422, `차단 안 됨: ${JSON.stringify(r)}`)
})

test('네이버 발행 + coupa.ng 단축 링크 → 422 차단', () => {
  const body = '후기 본문\nhttps://coupa.ng/xyz'
  const r = checkPublishGate({ post_type: 'review', body_text: body, match_score: 90, platform: 'naver' })
  assert(!r.ok && r.status === 422, `차단 안 됨: ${JSON.stringify(r)}`)
})

test('티스토리 발행 + 쿠팡 링크 → 통과 (제휴 채널)', () => {
  const body = '큐레이션 본문 (이 포스팅은 쿠팡 파트너스 활동의 일환으로 수수료를 제공받습니다)\nhttps://link.coupang.com/a/abc123'
  const r = checkPublishGate({ post_type: 'review', body_text: body, match_score: 90, platform: 'tistory' })
  assert(r.ok, `티스토리인데 차단됨: ${JSON.stringify(r)}`)
})

test('네이버 발행 + 쿠팡 링크 없음 → 통과', () => {
  const r = checkPublishGate({ post_type: 'review', body_text: '평범한 방문 후기', match_score: 90, platform: 'naver' })
  assert(r.ok, `차단됨: ${JSON.stringify(r)}`)
})

// ── 3. 정책 감사 디스패치 ─────────────────────────────────────────────────────

console.log('\n[3] 정책 감사 디스패치')

test('commerce_pack + 가짜 사용 표현(not_used) → 422 + audit 포함', () => {
  const body = COMMERCE_BODY + '\n직접 써보니 좋았어요.'
  const r = checkPublishGate({ post_type: 'commerce_pack', body_text: body, match_score: 90, usage_basis: 'not_used' })
  assert(!r.ok && r.status === 422, `차단 안 됨: ${JSON.stringify(r).slice(0, 200)}`)
  assert(!r.ok && !!r.audit, 'audit 결과가 응답에 없음')
})

test('commerce_pack 정상(mock, not_used) → 통과', () => {
  const r = checkPublishGate({ post_type: 'commerce_pack', body_text: COMMERCE_BODY, match_score: 90, usage_basis: 'not_used' })
  assert(r.ok, `차단됨: ${JSON.stringify(r).slice(0, 300)}`)
})

test('product + 체험담 표현 + usage_basis 미지정 → curation 기본값으로 422 차단', () => {
  const body = PLAIN_BODY + '\n며칠 사용해봤는데 손이 자주 갔어요.'
  const r = checkPublishGate({ post_type: 'product', body_text: body, match_score: 90 })
  assert(!r.ok && r.status === 422, `차단 안 됨: ${JSON.stringify(r).slice(0, 200)}`)
})

test('product + 체험담 표현 + used → 통과 (실사용 허용)', () => {
  const body = PLAIN_BODY + '\n며칠 사용해봤는데 손이 자주 갔어요.'
  const r = checkPublishGate({ post_type: 'product', body_text: body, match_score: 90, usage_basis: 'used' })
  assert(r.ok, `used인데 차단됨: ${JSON.stringify(r).slice(0, 200)}`)
})

test('product 정보성 글 → 통과', () => {
  const r = checkPublishGate({ post_type: 'product', body_text: PLAIN_BODY, match_score: 90 })
  assert(r.ok, `차단됨: ${JSON.stringify(r).slice(0, 300)}`)
})

test('review/daily는 상품 감사 미적용 (먹어보니 허용)', () => {
  const body = '# 성수동 맛집\n\n마제소바 먹어보니 진하고 좋았어요ㅋㅋ'
  const r = checkPublishGate({ post_type: 'review', body_text: body, match_score: 90 })
  assert(r.ok, `방문 후기인데 상품 감사로 차단됨: ${JSON.stringify(r).slice(0, 200)}`)
})

// ── 4. auditPlainPost 단독 ────────────────────────────────────────────────────

console.log('\n[4] auditPlainPost')

test('섹션 없는 평문 → section_missing 미발생', () => {
  const r = auditPlainPost(PLAIN_BODY, 'curation')
  const hasSectionFail = r.findings.some(f => f.id.startsWith('section_missing_'))
  assert(!hasSectionFail, 'product 평문에 섹션 누락 fail이 뜸')
})

test('curation + 체험담 → fake_usage_claim fail', () => {
  const r = auditPlainPost(PLAIN_BODY + '\n받자마자 개봉해보니 만듦새가 좋더라고요.', 'curation')
  assert(r.overall === 'fail', `overall=${r.overall}`)
  assert(r.findings.some(f => f.id === 'fake_usage_claim'), 'fake_usage_claim 없음')
})

test('과장 표현 → warn (fail 아님)', () => {
  const r = auditPlainPost(PLAIN_BODY + '\n역대급 가성비입니다.', 'curation')
  assert(r.overall === 'warn', `overall=${r.overall}`)
})

test('깨끗한 글 → pass', () => {
  const r = auditPlainPost(PLAIN_BODY, 'curation')
  assert(r.overall === 'pass', `overall=${r.overall}: ${JSON.stringify(r.findings)}`)
})

// ── 결과 ──────────────────────────────────────────────────────────────────────

console.log(`\n── 결과: ${passed} passed, ${failed} failed ──\n`)
if (failed > 0) {
  process.exit(1)
}
