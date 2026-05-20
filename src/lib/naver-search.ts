interface NaverLocalItem {
  title: string
  category: string
  description: string
  telephone: string
  address: string
  roadAddress: string
  link: string  // 네이버 플레이스 URL (placeId 추출용)
}

interface NaverBlogItem {
  title: string
  description: string
  bloggername: string
  postdate: string
}

interface NaverImageItem {
  link: string
  thumbnail: string
}

function stripHtml(str: string): string {
  return str.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').trim()
}

// 네이버 플레이스 URL에서 placeId 추출
function extractPlaceId(link: string): string | null {
  const match = link.match(/(?:place|entry\/place)\/(\d+)/)
  return match?.[1] ?? null
}

async function naverFetch(endpoint: string, query: string, extra = ''): Promise<unknown[] | null> {
  const clientId = process.env.NAVER_CLIENT_ID
  const clientSecret = process.env.NAVER_CLIENT_SECRET
  if (!clientId || !clientSecret) return null

  try {
    const url = `https://openapi.naver.com/v1/search/${endpoint}?query=${encodeURIComponent(query)}&display=5&sort=sim${extra}`
    const res = await fetch(url, {
      headers: {
        'X-Naver-Client-Id': clientId,
        'X-Naver-Client-Secret': clientSecret,
      },
      next: { revalidate: 3600 },
    })
    if (!res.ok) return null
    const data = await res.json() as { items?: unknown[] }
    return data.items ?? []
  } catch {
    return null
  }
}

// 네이버 플레이스 상세 정보 (비공식 API)
interface NaverPlaceDetail {
  name?: string
  category?: string
  address?: string
  phone?: string
  bizhourInfo?: string   // 영업시간
  visitorReviewCount?: number
  blogReviewCount?: number
  starScore?: number     // 별점
  bookingUrl?: string
  photos?: string[]      // 방문자 사진 URL 목록
}

async function fetchNaverPlaceDetail(placeId: string): Promise<NaverPlaceDetail | null> {
  try {
    // 네이버 플레이스 요약 API
    const res = await fetch(
      `https://map.naver.com/v5/api/sites/summary/${placeId}?lang=ko`,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Referer': 'https://map.naver.com/',
        },
        signal: AbortSignal.timeout(5000),
      }
    )
    if (!res.ok) return null
    const data = await res.json() as Record<string, unknown>

    // 방문자 사진 별도 요청
    let photos: string[] = []
    try {
      const photoRes = await fetch(
        `https://map.naver.com/v5/api/sites/photo?id=${placeId}&size=10&page=1`,
        {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Referer': 'https://map.naver.com/',
          },
          signal: AbortSignal.timeout(5000),
        }
      )
      if (photoRes.ok) {
        const photoData = await photoRes.json() as { result?: { photos?: { url?: string }[] } }
        photos = (photoData.result?.photos ?? []).slice(0, 8).map(p => p.url ?? '').filter(Boolean)
      }
    } catch { /* 사진 없어도 계속 */ }

    return {
      name: (data.name as string) || undefined,
      category: (data.category as string) || undefined,
      address: (data.roadAddress as string) || (data.address as string) || undefined,
      phone: (data.phone as string) || undefined,
      bizhourInfo: (data.bizhourInfo as string) || undefined,
      visitorReviewCount: (data.visitorReviewCount as number) || undefined,
      blogReviewCount: (data.blogReviewCount as number) || undefined,
      starScore: (data.starScore as number) || undefined,
      bookingUrl: (data.bookingUrl as string) || undefined,
      photos,
    }
  } catch {
    return null
  }
}

export async function fetchNaverImages(query: string, count = 2): Promise<string[]> {
  const items = await naverFetch('image.json', query, `&filter=large`)
  if (!items?.length) return []
  return (items as NaverImageItem[])
    .slice(0, count)
    .map((it) => it.link)
    .filter(Boolean)
}

// placeId + 상세 정보를 함께 반환
export interface PlaceSearchResult {
  placeId: string | null
  detail: NaverPlaceDetail | null
  basicInfo: NaverLocalItem | null
  placePhotos: string[]
}

export async function searchPlace(placeName: string): Promise<PlaceSearchResult> {
  const localItems = await naverFetch('local.json', placeName)
  const basicInfo = (localItems?.[0] as NaverLocalItem) ?? null

  const placeId = basicInfo?.link ? extractPlaceId(basicInfo.link) : null
  const detail = placeId ? await fetchNaverPlaceDetail(placeId) : null

  return {
    placeId,
    detail,
    basicInfo,
    placePhotos: detail?.photos ?? [],
  }
}

export async function buildPlaceContext(placeName: string): Promise<string> {
  const [placeResult, blogItems] = await Promise.all([
    searchPlace(placeName),
    naverFetch('blog.json', placeName + ' 후기'),
  ])

  const lines: string[] = []
  const { basicInfo, detail } = placeResult

  // 상세 정보 우선, 없으면 기본 정보 사용
  const name     = detail?.name     || (basicInfo ? stripHtml(basicInfo.title) : '')
  const category = detail?.category || basicInfo?.category || ''
  const address  = detail?.address  || basicInfo?.roadAddress || basicInfo?.address || ''
  const phone    = detail?.phone    || basicInfo?.telephone || ''

  if (name || address) {
    lines.push('## 장소 정보 (네이버 플레이스)')
    if (name)     lines.push(`- 이름: ${name}`)
    if (category) lines.push(`- 카테고리: ${category}`)
    if (address)  lines.push(`- 주소: ${address}`)
    if (phone)    lines.push(`- 전화: ${phone}`)

    if (detail?.bizhourInfo)      lines.push(`- 영업시간: ${detail.bizhourInfo}`)
    if (detail?.starScore)        lines.push(`- 별점: ${detail.starScore}점`)
    if (detail?.visitorReviewCount) lines.push(`- 방문자 리뷰: ${detail.visitorReviewCount}개`)
    if (detail?.blogReviewCount)  lines.push(`- 블로그 리뷰: ${detail.blogReviewCount}개`)
    if (detail?.bookingUrl)       lines.push(`- 예약: ${detail.bookingUrl}`)
  }

  // 블로그 후기 요약
  if (blogItems?.length) {
    lines.push('\n## 다른 블로거 후기 (참고용)')
    ;(blogItems as NaverBlogItem[]).slice(0, 2).forEach((item, i) => {
      const title = stripHtml(item.title)
      const desc  = stripHtml(item.description).slice(0, 100)
      lines.push(`${i + 1}. "${title}" — ${desc}…`)
    })
  }

  if (!lines.length) return ''

  return `\n\n${lines.join('\n')}\n\n⚠️ 위 정보는 참고용. 내가 직접 경험한 내용과 다르면 내 경험 우선. 검색 정보는 "~로 알려져 있어요" 톤으로만 사용.`
}
