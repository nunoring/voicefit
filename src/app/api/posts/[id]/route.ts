import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { markdownToHtml, buildImageUrlMap, appendLegalDisclosure } from '@/lib/markdown'
import type { Post } from '@/types'

export async function GET(_req: NextRequest, ctx: RouteContext<'/api/posts/[id]'>) {
  try {
    const { id } = await ctx.params
    const supabase = createServerClient()

    const [{ data, error }, { data: imgRows }] = await Promise.all([
      supabase.from('posts').select('*').eq('id', id).single(),
      supabase
        .from('post_images')
        .select('public_url, placement_index')
        .eq('post_id', id)
        .order('placement_index', { ascending: true })
        .order('created_at', { ascending: true }),
    ])

    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json({ error: '포스트를 찾을 수 없습니다.' }, { status: 404 })
      }
      throw new Error(error.message)
    }

    const post = data as unknown as Post

    // 이미지 순번 기반 URL 맵 → body_html 계산 (클라이언트 마크다운 파서 불필요)
    const imageUrls = buildImageUrlMap((imgRows ?? []) as { public_url: string }[])
    const body_html = post.body_text
      ? appendLegalDisclosure(markdownToHtml(post.body_text, imageUrls))
      : null

    return NextResponse.json({ ...post, body_html })
  } catch (err) {
    const message = err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
