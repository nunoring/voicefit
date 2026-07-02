import { createHmac } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import type { ProductItem } from '@/types'

function buildCoupangAuth(method: string, path: string, query: string) {
  const now = new Date()
  // yyyyMMddTHHmmssZ
  const datetime =
    now.getUTCFullYear().toString() +
    String(now.getUTCMonth() + 1).padStart(2, '0') +
    String(now.getUTCDate()).padStart(2, '0') +
    'T' +
    String(now.getUTCHours()).padStart(2, '0') +
    String(now.getUTCMinutes()).padStart(2, '0') +
    String(now.getUTCSeconds()).padStart(2, '0') +
    'Z'

  const message = `${datetime}\n${method}\n${path}\n${query}`
  const signature = createHmac('sha256', process.env.COUPANG_SECRET_KEY ?? '')
    .update(message)
    .digest('hex')

  return {
    datetime,
    header: `CEA algorithm=HmacSHA256, access-key=${process.env.COUPANG_ACCESS_KEY}, signed-date=${datetime}, signature=${signature}`,
  }
}

async function fetchCoupangProducts(keyword: string): Promise<ProductItem[]> {
  const path = '/v2/providers/affiliate_open_api/apis/openapi/v1/products/search'
  const query = `keyword=${encodeURIComponent(keyword)}&limit=10`
  const { header } = buildCoupangAuth('GET', path, query)

  const res = await fetch(
    `https://api-gateway.coupang.com${path}?${query}`,
    {
      headers: {
        Authorization: header,
        'Content-Type': 'application/json;charset=UTF-8',
      },
    },
  )

  if (!res.ok) throw new Error(`Coupang API ${res.status}`)

  const json = await res.json()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw: any[] = json.data?.productData ?? []

  return raw.map((p) => ({
    name: p.productName ?? '',
    price: p.productPrice ?? undefined,
    url: p.productUrl ?? undefined,
    image_url: p.productImage ?? undefined,
    description: p.productTypeName ?? undefined,
  }))
}

function normalizeUrl(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  try {
    return new URL(withProtocol).href
  } catch {
    return null
  }
}

function extractMeta(html: string, property: string) {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const patterns = [
    new RegExp(`<meta[^>]+property=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${escaped}["'][^>]*>`, 'i'),
    new RegExp(`<meta[^>]+name=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${escaped}["'][^>]*>`, 'i'),
  ]
  for (const pattern of patterns) {
    const match = html.match(pattern)
    if (match?.[1]) return decodeHtml(match[1]).trim()
  }
  return ''
}

function decodeHtml(value: string) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

function cleanProductTitle(title: string) {
  return title
    .replace(/\s*[-|]\s*쿠팡!?$/i, '')
    .replace(/\s*[-|]\s*Coupang!?$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}

async function fetchUrlProduct(url: string): Promise<ProductItem> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      redirect: 'follow',
    })
    if (!res.ok) throw new Error(`Product page ${res.status}`)
    const html = await res.text()
    const title =
      cleanProductTitle(extractMeta(html, 'og:title')) ||
      cleanProductTitle(html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] ?? '')
    const image = extractMeta(html, 'og:image')

    return {
      name: title || '상품명 입력 필요',
      url,
      image_url: image || undefined,
      description: 'URL에서 자동 입력',
    }
  } catch {
    return {
      name: '상품명 입력 필요',
      url,
      description: 'URL만 자동 입력됨',
    }
  }
}

export async function POST(req: NextRequest) {
  const { source, query_or_url } = (await req.json()) as {
    source?: string
    query_or_url?: string
  }

  if (!query_or_url?.trim()) {
    return NextResponse.json({ error: '검색어를 입력해주세요.' }, { status: 400 })
  }

  // 올리브영: 공식 API 없음 → 수동 입력으로 유도
  if (source === 'oliveyoung') {
    return NextResponse.json({ fallback: true }, { status: 503 })
  }

  const normalizedUrl = normalizeUrl(query_or_url)
  if (normalizedUrl) {
    const item = await fetchUrlProduct(normalizedUrl)
    return NextResponse.json({ items: [item], fallback: item.name === '상품명 입력 필요' })
  }

  const accessKey = process.env.COUPANG_ACCESS_KEY
  const secretKey = process.env.COUPANG_SECRET_KEY
  if (!accessKey || !secretKey) {
    return NextResponse.json({ fallback: true }, { status: 503 })
  }

  try {
    const items = await fetchCoupangProducts(query_or_url.trim())
    return NextResponse.json({ items })
  } catch {
    // API 호출 실패 시 fallback → 클라이언트가 수동 입력 폼으로 전환
    return NextResponse.json({ fallback: true }, { status: 503 })
  }
}
