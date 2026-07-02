/**
 * 쇼츠 렌더 플랜 유닛 테스트 — FFmpeg 실행 없이 파서/자막 생성만 검증.
 * 실행: npx tsx scripts/test-shorts-render-plan.ts
 */

import { buildMockCommercePackBody } from '../src/lib/commerce-pack'
import { buildAssSubtitles, buildShortsRenderPlan, wrapCaptionText } from '../src/lib/shorts-render-plan'

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

const PRODUCT = {
  items: [{ name: '테스트 수세미', price: 6900, url: 'https://example.com', description: '천연 수세미' }],
}

const MARKDOWN = buildMockCommercePackBody(PRODUCT as never, 'not_used')

console.log('\n[1] buildShortsRenderPlan')

test('9:16 쇼츠 기본 포맷으로 변환', () => {
  const plan = buildShortsRenderPlan(MARKDOWN, { productName: '테스트 수세미' })
  assert(plan.format === 'youtube_shorts', `format=${plan.format}`)
  assert(plan.size.width === 1080 && plan.size.height === 1920, `size=${plan.size.width}x${plan.size.height}`)
  assert(plan.fps === 30, `fps=${plan.fps}`)
})

test('쇼츠 대본 타임코드를 scene으로 파싱', () => {
  const plan = buildShortsRenderPlan(MARKDOWN)
  assert(plan.scenes.length >= 3, `scene ${plan.scenes.length}개`)
  assert(plan.scenes[0].startSec === 0, `first start=${plan.scenes[0].startSec}`)
  assert(plan.scenes[0].endSec > plan.scenes[0].startSec, '첫 scene 종료 시간이 시작보다 작거나 같음')
})

test('제작 지시서 필드를 render plan으로 승격', () => {
  const plan = buildShortsRenderPlan(MARKDOWN)
  assert(plan.goal.includes('20초'), '목표 필드 파싱 실패')
  assert(plan.hook.includes('가격'), '0~3초 후킹 파싱 실패')
  assert(plan.brollHint.includes('상품 이미지'), 'B-roll 필드 파싱 실패')
  assert(plan.voiceTone.includes('정보 제공자'), 'TTS 톤 파싱 실패')
  assert(plan.cutTiming.includes('컷 전환'), '컷 타이밍 파싱 실패')
})

test('제휴 고지 오버레이 생성', () => {
  const plan = buildShortsRenderPlan(MARKDOWN)
  assert(plan.disclosureOverlay === '제휴 링크 포함 콘텐츠', `disclosure=${plan.disclosureOverlay}`)
})

test('상품 이미지와 정보 카드 asset 슬롯 생성', () => {
  const plan = buildShortsRenderPlan(MARKDOWN, {
    productImageUrls: ['https://example.com/a.jpg', 'https://example.com/b.jpg'],
  })
  assert(plan.assets.length === 3, `assets=${plan.assets.length}`)
  assert(plan.assets[0].role === 'product_image', `first role=${plan.assets[0].role}`)
  assert(plan.assets[0].sourceUrl === 'https://example.com/a.jpg', '상품 이미지 URL 누락')
  assert(plan.assets.some((asset) => asset.role === 'info_card'), '정보 카드 asset 없음')
})

test('긴 자막을 짧은 줄로 래핑', () => {
  const wrapped = wrapCaptionText('테스트 수세미 가격만 보고 넘기기 전에 구성부터 확인하세요', 10, 3)
  const lines = wrapped.split('\n')
  assert(lines.length <= 3, `line ${lines.length}개`)
  assert(lines.every((line) => line.length <= 10), `너무 긴 줄: ${wrapped}`)
})

console.log('\n[2] buildAssSubtitles')

test('ASS 자막 파일 구조 생성', () => {
  const plan = buildShortsRenderPlan(MARKDOWN)
  const ass = buildAssSubtitles(plan)
  assert(ass.includes('[Script Info]'), 'Script Info 없음')
  assert(ass.includes('[V4+ Styles]'), 'Styles 없음')
  assert(ass.includes('[Events]'), 'Events 없음')
  assert(ass.includes('Style: Caption'), 'Caption 스타일 없음')
})

test('scene 수만큼 Caption 이벤트 생성', () => {
  const plan = buildShortsRenderPlan(MARKDOWN)
  const ass = buildAssSubtitles(plan)
  const captionEvents = ass.split('\n').filter((line) => line.includes(',Caption,'))
  assert(captionEvents.length === plan.scenes.length, `caption events=${captionEvents.length}, scenes=${plan.scenes.length}`)
})

test('scene visualHint 이벤트 생성', () => {
  const plan = buildShortsRenderPlan(MARKDOWN)
  const ass = buildAssSubtitles(plan)
  const hintEvents = ass.split('\n').filter((line) => line.includes(',VisualHint,'))
  assert(hintEvents.length === plan.scenes.length, `visual hint events=${hintEvents.length}, scenes=${plan.scenes.length}`)
})

console.log(`\n── 결과: ${passed} passed, ${failed} failed ──\n`)
if (failed > 0) {
  process.exit(1)
}
