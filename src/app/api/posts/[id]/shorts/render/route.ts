import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { getLocalPost } from '@/lib/local-posts'
import { buildShortsRenderPlan } from '@/lib/shorts-render-plan'
import { renderShortsVideo } from '@/lib/shorts-video-renderer'
import type { ProductData } from '@/types'

export const runtime = 'nodejs'

type CommercePostForShorts = {
  body_text: string | null
  post_type: string | null
  product_data_json: ProductData | null
}

function productName(product: ProductData | null): string | null {
  return product?.items?.[0]?.name?.trim() || null
}

function productImageUrls(product: ProductData | null): string[] {
  return (product?.items ?? []).map((item) => item.image_url).filter((url): url is string => !!url)
}

async function loadCommercePost(id: string): Promise<CommercePostForShorts> {
  if (id.startsWith('local_post_')) {
    const post = await getLocalPost(id)
    if (!post) throw new Error('포스트를 찾을 수 없습니다.')
    return {
      body_text: post.body_text,
      post_type: post.post_type,
      product_data_json: post.product_data_json,
    }
  }

  const supabase = createServerClient()
  const { data, error } = await supabase
    .from('posts')
    .select('body_text, post_type, product_data_json')
    .eq('id', id)
    .single()

  if (error) throw new Error(error.message)
  return data as unknown as CommercePostForShorts
}

async function buildPlanResponse(id: string) {
  const post = await loadCommercePost(id)
  if (post.post_type !== 'commerce_pack') {
    return NextResponse.json({ error: '쇼츠 렌더는 commerce_pack 글에만 적용됩니다.' }, { status: 400 })
  }
  if (!post.body_text) {
    return NextResponse.json({ error: '쇼츠 렌더에 사용할 본문이 없습니다.' }, { status: 400 })
  }

  const plan = buildShortsRenderPlan(post.body_text, {
    productName: productName(post.product_data_json),
    productImageUrls: productImageUrls(post.product_data_json),
  })
  if (!plan.scenes.length) {
    return NextResponse.json({ error: '쇼츠 대본 섹션이 비어 있습니다.' }, { status: 422 })
  }
  return NextResponse.json({ plan })
}

export async function GET(_req: NextRequest, ctx: RouteContext<'/api/posts/[id]/shorts/render'>) {
  try {
    const { id } = await ctx.params
    return await buildPlanResponse(id)
  } catch (err) {
    const message = err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST(_req: NextRequest, ctx: RouteContext<'/api/posts/[id]/shorts/render'>) {
  try {
    const { id } = await ctx.params
    const post = await loadCommercePost(id)
    if (post.post_type !== 'commerce_pack') {
      return NextResponse.json({ error: '쇼츠 렌더는 commerce_pack 글에만 적용됩니다.' }, { status: 400 })
    }
    if (!post.body_text) {
      return NextResponse.json({ error: '쇼츠 렌더에 사용할 본문이 없습니다.' }, { status: 400 })
    }

    const plan = buildShortsRenderPlan(post.body_text, {
      productName: productName(post.product_data_json),
      productImageUrls: productImageUrls(post.product_data_json),
    })
    if (!plan.scenes.length) {
      return NextResponse.json({ error: '쇼츠 대본 섹션이 비어 있습니다.' }, { status: 422 })
    }

    const rendered = await renderShortsVideo(plan, id)
    return NextResponse.json({
      ok: true,
      plan,
      durationSec: rendered.durationSec,
      sizeBytes: rendered.sizeBytes,
      video_url: `/api/posts/${encodeURIComponent(id)}/shorts/video`,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
