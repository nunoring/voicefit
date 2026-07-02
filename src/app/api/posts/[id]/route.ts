import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { markdownToHtml, buildImageUrlMap, appendLegalDisclosureIfNeeded } from '@/lib/markdown'
import { getLocalPost, updateLocalPost } from '@/lib/local-posts'
import { listLocalPostImages } from '@/lib/local-post-images'
import type { Post } from '@/types'

export async function GET(_req: NextRequest, ctx: RouteContext<'/api/posts/[id]'>) {
  try {
    const { id } = await ctx.params
    if (id.startsWith('local_post_')) {
      const post = await getLocalPost(id)
      if (!post) {
        return NextResponse.json({ error: '포스트를 찾을 수 없습니다.' }, { status: 404 })
      }
      const imageUrls = buildImageUrlMap(await listLocalPostImages(id))
      const rawHtml = post.body_text ? markdownToHtml(post.body_text, imageUrls) : null
      const body_html = rawHtml
        ? appendLegalDisclosureIfNeeded(rawHtml, post.body_text ?? '', post.post_type)
        : null
      return NextResponse.json({ ...post, body_html })
    }

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
    const rawHtml = post.body_text ? markdownToHtml(post.body_text, imageUrls) : null
    const body_html = rawHtml
      ? appendLegalDisclosureIfNeeded(rawHtml, post.body_text ?? '', post.post_type)
      : null

    return NextResponse.json({ ...post, body_html })
  } catch (err) {
    const message = err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest, ctx: RouteContext<'/api/posts/[id]'>) {
  try {
    const { id } = await ctx.params
    const body = (await req.json()) as { body_text?: unknown }
    const bodyText = typeof body.body_text === 'string' ? body.body_text : null
    if (bodyText == null) {
      return NextResponse.json({ error: 'body_text가 필요합니다.' }, { status: 400 })
    }

    if (id.startsWith('local_post_')) {
      const post = await updateLocalPost(id, {
        body_text: bodyText,
        status: 'scored',
        match_score: null,
        score_detail_json: null,
      })
      if (!post) {
        return NextResponse.json({ error: '포스트를 찾을 수 없습니다.' }, { status: 404 })
      }
      return NextResponse.json({ body_text: post.body_text, status: post.status })
    }

    const supabase = createServerClient()
    const { data, error } = await supabase
      .from('posts')
      .update({ body_text: bodyText, status: 'scored', match_score: null, score_detail_json: null })
      .eq('id', id)
      .select('body_text, status')
      .single()

    if (error) throw new Error(error.message)
    return NextResponse.json(data)
  } catch (err) {
    const message = err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
