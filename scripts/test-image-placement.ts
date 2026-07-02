/**
 * Image placement helper tests.
 * Run: npm run test:image
 */

import {
  buildImageSlotsText,
  classifyImageType,
  inferredPlacementIndex,
  resolveImageSlots,
} from '../src/lib/image-placement'
import type { PostImage } from '../src/types'

let passed = 0
let failed = 0

function test(name: string, fn: () => void): void {
  try {
    fn()
    console.log(`  OK ${name}`)
    passed++
  } catch (e) {
    console.log(`  FAIL ${name}: ${e instanceof Error ? e.message : String(e)}`)
    failed++
  }
}

function assert(condition: boolean, msg: string): void {
  if (!condition) throw new Error(msg)
}

function image(input: Partial<PostImage>): PostImage {
  return {
    id: input.id ?? 'img_1',
    post_id: input.post_id ?? 'post_1',
    source_type: input.source_type ?? 'user_uploaded',
    storage_path: input.storage_path ?? 'post_1/test.jpg',
    public_url: input.public_url ?? 'https://example.com/test.jpg',
    vision_interpretation: input.vision_interpretation ?? null,
    placement_index: input.placement_index ?? null,
    generated_paragraph: input.generated_paragraph ?? null,
    created_at: input.created_at ?? '2026-07-01T00:00:00.000Z',
  }
}

console.log('\n[1] image type classification')

test('uses generated paragraph when vision text is sparse', () => {
  const type = classifyImageType('깔끔하게 찍힌 사진', '박스랑 구성품이 같이 보여서 언박싱 느낌으로 넣기 좋다.')
  assert(type === '제품', `type=${type}`)
})

test('classifies place exterior, food, and product photos', () => {
  assert(classifyImageType('건물 입구와 간판이 보인다') === '외관', 'exterior failed')
  assert(classifyImageType('고기랑 반찬이 테이블에 놓여 있다') === '음식', 'food failed')
  assert(classifyImageType('충전 케이블과 본품 색상이 보인다') === '제품', 'product failed')
})

console.log('\n[2] prompt slots')

test('builds placement-aware photo instructions', () => {
  const text = buildImageSlotsText([
    image({ vision_interpretation: '매장 입구 간판 사진', placement_index: 0 }),
    image({
      id: 'img_2',
      vision_interpretation: '제품 박스와 구성품 사진',
      generated_paragraph: '생각보다 구성품이 단순해서 처음 볼 때 바로 이해됐다.',
      placement_index: 1,
    }),
  ])

  assert(text.includes('<사진1_외관>'), text)
  assert(text.includes('<사진2_제품>'), text)
  assert(text.includes('권장 위치: 도입부'), text)
  assert(text.includes('권장 위치: 중반'), text)
  assert(text.includes('대표 1장'), 'dedupe instruction missing')
  assert(text.includes('사진 주변 한마디 후보'), 'photo paragraph hint missing')
})

console.log('\n[3] slot resolution')

test('converts explicit photo placeholders to markdown image markers', () => {
  const body = ['첫 문단', '<사진2_제품>', '마무리'].join('\n\n')
  const resolved = resolveImageSlots(body, [
    image({ id: 'img_1' }),
    image({ id: 'img_2' }),
  ])

  assert(resolved.includes('![image-2]'), resolved)
  assert(!resolved.includes('<사진2_제품>'), resolved)
})

test('falls back to vision placement order when model omits placeholders', () => {
  const body = ['도입', '첫인상', '중간 설명', '제품 디테일', '아쉬운 점', '총평'].join('\n\n')
  const resolved = resolveImageSlots(body, [
    image({ id: 'img_intro', vision_interpretation: '매장 입구', placement_index: 0 }),
    image({ id: 'img_mid', vision_interpretation: '제품 박스와 구성품', placement_index: 1 }),
    image({ id: 'img_end', vision_interpretation: '마지막 사용 후 컷', placement_index: 2 }),
  ])

  const first = resolved.indexOf('![image-1]')
  const second = resolved.indexOf('![image-2]')
  const third = resolved.indexOf('![image-3]')
  assert(first >= 0 && second >= 0 && third >= 0, resolved)
  assert(first < second && second < third, resolved)
})

test('infers placement from image type when vision has no placement index', () => {
  assert(inferredPlacementIndex(image({ vision_interpretation: '외관과 입구가 보인다' })) === 0, 'exterior placement failed')
  assert(inferredPlacementIndex(image({ vision_interpretation: '음식이 테이블 위에 있다' })) === 1, 'food placement failed')
})

test('resolves type-less and spaced slot variants (<사진1>, <사진 2>)', () => {
  const body = ['첫 문단', '<사진1>', '중간', '<사진 2>', '끝'].join('\n\n')
  const resolved = resolveImageSlots(body, [image({ id: 'img_1' }), image({ id: 'img_2' })])
  assert(resolved.includes('![image-1]'), resolved)
  assert(resolved.includes('![image-2]'), resolved)
  assert(!resolved.includes('<사진'), `잔여 슬롯 텍스트 남음: ${resolved}`)
})

test('strips leftover malformed photo tokens instead of publishing them as text', () => {
  const body = ['본문', '<사진_외관>', '마무리'].join('\n\n')
  const resolved = resolveImageSlots(body, [])
  assert(!resolved.includes('<사진'), `잔여 슬롯 텍스트 남음: ${resolved}`)
})

test('distributes official product images mid-body when model omits placeholders', () => {
  // 공식 이미지 URL만 있는 상품 홍보글 시나리오: vision/placement 없음 → 제품 타입 추론 → 중반 배치
  const body = ['도입', '특징 설명', '구성 정리', '추천 대상', '마무리'].join('\n\n')
  const resolved = resolveImageSlots(body, [
    image({ id: 'img_official', source_type: 'official', vision_interpretation: '제품 본품과 패키지 이미지' }),
  ])
  const paras = resolved.split(/\n{2,}/)
  const markerIndex = paras.findIndex((p) => p.includes('![image-1]'))
  assert(markerIndex > 0, `이미지가 맨 위에 몰림: ${resolved}`)
  assert(markerIndex < paras.length - 1, `이미지가 맨 끝에 몰림: ${resolved}`)
})

console.log(`\nResult: ${passed} passed, ${failed} failed\n`)
if (failed > 0) {
  process.exit(1)
}
