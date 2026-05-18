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
