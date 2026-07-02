import type { PostImage } from '@/types'

export function classifyImageType(interpretation: string | null, generatedParagraph?: string | null): string {
  const t = `${interpretation ?? ''}\n${generatedParagraph ?? ''}`
  if (!t.trim()) return '사진'
  if (/외관|건물|입구|간판|전경/.test(t)) return '외관'
  if (/메뉴판|메뉴|가격표/.test(t)) return '메뉴판'
  if (/고기|음식|요리|반찬|구워|삼겹|갈비|스테이크|생선|밥|국|찌개|라면|피자|파스타|케이크|커피|음료/.test(t)) return '음식'
  if (/제품|박스|패키지|구성품|언박싱|본품|용량|색상|실리콘|충전|케이블/.test(t)) return '제품'
  if (/내부|인테리어|홀|테이블|좌석|공간/.test(t)) return '내부'
  return '사진'
}

export function placementLabel(index: number | null): string {
  if (index === 0) return '도입부'
  if (index === 1) return '중반'
  if (index === 2) return '후반'
  return '글 흐름상 자연스러운 지점'
}

export function buildImageSlotsText(images: PostImage[]): string {
  if (!images.length) return '이미지 없음 - 이미지 플레이스홀더 삽입 금지.'

  const slots = images.map((img, i) => {
    const type = classifyImageType(img.vision_interpretation, img.generated_paragraph)
    const desc = img.vision_interpretation
      ? img.vision_interpretation.split(/[.。]/)[0].trim()
      : `사진 ${i + 1}`
    const paragraph = img.generated_paragraph?.trim()
    const placement = placementLabel(img.placement_index)
    return [
      `- <사진${i + 1}_${type}>`,
      `  - 권장 위치: ${placement}`,
      `  - 사진 내용: ${desc}`,
      paragraph ? `  - 사진 주변 한마디 후보: ${paragraph}` : null,
    ].filter(Boolean).join('\n')
  })

  return `아래는 첨부된 사진 목록이다. 글 흐름에 맞게 배치하되 '선별'한다.

- 모든 사진을 다 넣을 필요 없다. 글에 가치를 더하는 사진만 고른다.
- 서로 비슷한 사진(거의 같은 구도, 피사체, 예: 반지 클로즈업 여러 장)은 대표 1장만 쓰고 나머지는 생략.
- 굳이 없어도 글이 자연스러운 사진은 뺀다.
- 권장 위치가 도입부인 사진(외관/입구/첫인상)은 제목 직후나 첫인상 문단 뒤에 둔다.
- 권장 위치가 중반인 사진(내부/메뉴/음식/제품 디테일)은 해당 설명 문단 바로 뒤에 둔다.
- 권장 위치가 후반인 사진(총평/사용 후/마무리 컷)은 아쉬운 점이나 총평 직전에 둔다.
- 매 사진마다 일일이 코멘트 달지 말 것. 의미 있는 사진에만 사진 주변 한마디 후보를 말투에 맞게 자연스럽게 변형해 쓴다.
- 넣을 사진만 <사진N_타입> 플레이스홀더를 해당 문단 뒤 단독 라인으로 삽입. 뺄 사진의 플레이스홀더는 쓰지 않는다.
- 사진 플레이스홀더는 반드시 단독 라인에 둔다.

${slots.join('\n')}`
}

export function resolveImageSlots(bodyText: string, images: PostImage[]): string {
  // 모델이 타입을 생략하거나(<사진1>) 공백을 넣어도(<사진 1>) 해석되게 변형 허용.
  // 매칭 안 되는 슬롯이 본문에 텍스트로 남아 발행되는 사고 방지.
  let resolved = bodyText.replace(/<사진\s*(\d+)(?:_[^>]*)?>/g, (_, n) => {
    const idx = parseInt(n, 10) - 1
    return idx >= 0 && idx < images.length ? `![image-${n}]` : ''
  })
  // 그 외 잔여 <사진…> 토큰은 전부 제거 (숫자 없는 변형 등)
  resolved = resolved.replace(/<사진[^>]*>/g, '')

  const hasMarkers = /!\[image-\d+\]/.test(resolved)
  if (!hasMarkers && images.length) {
    return injectMarkersByPlacement(resolved, images)
  }
  return resolved
}

export function inferredPlacementIndex(img: PostImage): number {
  if (img.placement_index === 0 || img.placement_index === 1 || img.placement_index === 2) {
    return img.placement_index
  }
  const type = classifyImageType(img.vision_interpretation, img.generated_paragraph)
  if (type === '외관' || type === '내부') return 0
  if (type === '메뉴판' || type === '음식' || type === '제품') return 1
  return 2
}

export function injectMarkersByPlacement(bodyText: string, images: PostImage[]): string {
  const paras = bodyText.split(/\n{2,}/).filter(Boolean)
  if (!paras.length) return bodyText

  const total = paras.length
  images.forEach((_, i) => {
    const placement = inferredPlacementIndex(images[i])
    const ratio = placement === 0 ? 0.18 : placement === 1 ? 0.52 : 0.82
    const offset = images.length > 1 ? (i / Math.max(1, images.length - 1) - 0.5) * 0.12 : 0
    const pos = Math.max(0, Math.min(total - 1, Math.round((ratio + offset) * (total - 1))))
    paras[pos] = paras[pos] + `\n\n![image-${i + 1}]`
  })

  return paras.join('\n\n')
}
