/**
 * 이미지 소스 정책 (D-006 확정: 쿠팡 파트너스 A안):
 *   1. product_data.items[*].image_url (쿠팡 파트너스 공식 이미지) — 유일한 소스
 *   2. 사용자 업로드 이미지 (post_images 테이블에 user_uploaded로 이미 저장됨)
 *      → 클라이언트가 이미지 업로드 시 이 라우트를 호출하지 않으므로 자동 우회됨
 *
 * Unsplash 스톡 폴백 제거 이유:
 *   - 커머스 큐레이션 특성상 상품과 무관한 스톡 이미지는 신뢰도 저해
 *   - 공식 이미지 없으면 이미지 없이 발행 (텍스트 퀄리티로 승부)
 *
 * 쿠팡 파트너스 약관 준수:
 *   공식 이미지 URL은 해당 상품의 쿠팡 링크와 함께 사용하는 경우에만 허용.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { getLocalPost } from '@/lib/local-posts'
import { insertLocalOfficialImages } from '@/lib/local-post-images'
import type { ProductData } from '@/types'

export async function POST(
  req: NextRequest,
  ctx: RouteContext<'/api/posts/[id]/images/source'>,
) {
  try {
    const { id } = await ctx.params
    const { needed_count = 3 } = (await req.json()) as {
      needed_count?: number
      context?: string
    }

    if (id.startsWith('local_post_')) {
      const post = await getLocalPost(id)
      if (!post) return NextResponse.json({ error: '포스트를 찾을 수 없습니다.' }, { status: 404 })

      const officialUrls = (post.product_data_json?.items ?? [])
        .map((i) => i.image_url)
        .filter((u): u is string => !!u)
        .slice(0, needed_count)

      const rows = await insertLocalOfficialImages(id, officialUrls)
      return NextResponse.json({ saved: rows.length })
    }

    const supabase = createServerClient()

    const { data: post, error: postErr } = await supabase
      .from('posts')
      .select('product_data_json')
      .eq('id', id)
      .single()

    if (postErr) throw new Error(postErr.message)

    const product = (post as unknown as { product_data_json: ProductData | null }).product_data_json

    type ImageRow = {
      post_id: string
      source_type: 'official'
      storage_path: string
      public_url: string
      placement_index: number
    }

    // 쿠팡 파트너스 공식 이미지만 사용 (D-006 A안)
    const officialUrls = (product?.items ?? [])
      .map((i) => i.image_url)
      .filter((u): u is string => !!u)
      .slice(0, needed_count)

    if (!officialUrls.length) {
      return NextResponse.json({ saved: 0 })
    }

    const rows: ImageRow[] = officialUrls.map((url, i) => ({
      post_id: id,
      source_type: 'official',
      storage_path: '',
      public_url: url,
      placement_index: i + 1,
    }))

    const { error: insertErr } = await supabase
      .from('post_images')
      .insert(rows)

    if (insertErr) {
      console.error('[source] post_images insert error:', insertErr.message)
      return NextResponse.json({ saved: 0, warning: insertErr.message })
    }

    return NextResponse.json({ saved: rows.length })
  } catch (err) {
    const message = err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
