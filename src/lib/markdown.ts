// 마크다운 → HTML 변환 공유 유틸 (publish·GET route 양쪽에서 import)

// 쿠팡 파트너스 필수 고지 (전자상거래법 및 표시광고법 준수)
const LEGAL_DISCLOSURE_HTML =
  '<p style="margin-top:2em;padding:12px;background:#f8f8f8;border-left:3px solid #ccc;font-size:0.85em;color:#666;">' +
  '이 포스팅은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.' +
  '</p>'

/** 생성된 HTML 끝에 법적 고지문을 추가한다. */
export function appendLegalDisclosure(html: string): string {
  return html + '\n' + LEGAL_DISCLOSURE_HTML
}

function applyInline(text: string): string {
  return text
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g,     '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g,         '<em>$1</em>')
}

/**
 * post_images 배열을 받아 1-based 순번 → public_url 맵을 만든다.
 * placement_index 오름차순 → created_at 오름차순으로 정렬된 배열을
 * 그대로 넘기면 되고, 저장된 placement_index 값 자체는 사용하지 않는다.
 * (소싱·업로드 경로에 관계없이 배열 순서가 곧 마커 번호)
 */
export function buildImageUrlMap(
  images: { public_url: string }[],
): Record<string, string> {
  const map: Record<string, string> = {}
  images.forEach((img, i) => { map[String(i + 1)] = img.public_url })
  return map
}

/**
 * 마크다운 본문을 HTML로 변환한다.
 * - imageUrls: buildImageUrlMap() 결과. 키는 "1","2",... 숫자 문자열.
 * - ![image-N] → <img src=...> 치환. URL 없으면 빈 문자열로 제거(잔재 금지).
 */
export function markdownToHtml(
  md: string,
  imageUrls: Record<string, string>,
): string {
  const preprocessed = md
    // ![image-N] 치환 — 대소문자·공백/하이픈 변형 허용 (GPT 출력 편차 대응)
    // URL 없으면 '' (죽은 마커 제거)
    .replace(/!\[\s*image[-\s]?(\d+)\s*\]/gi, (_, n) => {
      const url = imageUrls[n]
      return url ? `<img src="${url}" alt="image-${n}" style="max-width:100%;border-radius:4px">` : ''
    })
    // 일반 마크다운 이미지
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" style="max-width:100%">')
    // 링크
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')

  const blocks = preprocessed.split(/\n{2,}/)

  return blocks
    .map((block) => {
      const trimmed = block.trim()
      if (!trimmed) return ''
      if (/^#{3} /.test(trimmed)) return trimmed.replace(/^### (.+)$/, '<h3>$1</h3>')
      if (/^#{2} /.test(trimmed)) return trimmed.replace(/^## (.+)$/, '<h2>$1</h2>')
      if (/^# /.test(trimmed))    return trimmed.replace(/^# (.+)$/,  '<h1>$1</h1>')
      if (trimmed.startsWith('<img')) return trimmed   // 이미 변환된 img 태그
      if (trimmed.includes('\n- ') || trimmed.startsWith('- ')) {
        const items = trimmed
          .split('\n')
          .filter((l) => l.startsWith('- '))
          .map((l) => `  <li>${applyInline(l.slice(2))}</li>`)
          .join('\n')
        return `<ul>\n${items}\n</ul>`
      }
      if (trimmed.startsWith('<')) return trimmed
      return `<p>${applyInline(trimmed.replace(/\n/g, '<br>'))}</p>`
    })
    .filter(Boolean)
    .join('\n')
}
