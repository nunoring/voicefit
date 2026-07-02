import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { insertLocalPost, listLocalPosts } from '@/lib/local-posts'
import type { ProductData, PostType, PostCreateResponse, UsageBasis } from '@/types'

export async function GET() {
  try {
    const supabase = createServerClient()
    const { data, error } = await supabase
      .from('posts')
      .select('id, status, post_type, publish_platform, product_data_json, body_text, match_score, naver_post_url, published_url, voice_profile_id, created_at, updated_at')
      .order('created_at', { ascending: false })
      .limit(50)

    if (error) throw new Error(error.message)
    return NextResponse.json(data ?? [])
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (message.includes('fetch failed')) {
      return NextResponse.json(await listLocalPosts())
    }
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      voice_profile_id?: string
      post_type?: PostType
      product_data?: ProductData
      daily_content?: string
      review_place?: string
      review_experience?: string
      coupang_product?: string
      coupang_experience?: string
      usage_basis?: UsageBasis
    }

    const { voice_profile_id, post_type, product_data, daily_content, review_place, review_experience, coupang_product, coupang_experience, usage_basis } = body

    if (!voice_profile_id) {
      return NextResponse.json({ error: 'voice_profile_id는 필수입니다.' }, { status: 400 })
    }
    const voiceProfileId = voice_profile_id

    // 글 유형별 content_json 구성
    const content_json =
      post_type === 'daily' ? { daily_content } :
      post_type === 'review' ? { review_place, review_experience } :
      post_type === 'coupang' ? { coupang_product, coupang_experience } :
      post_type === 'commerce_pack' ? { usage_basis: usage_basis ?? 'curation' } :
      null

    const postType = post_type ?? 'product'
    const productData = (postType === 'product' || postType === 'commerce_pack') ? (product_data ?? null) : null

    async function createLocalResponse() {
      const local = await insertLocalPost({
        voice_profile_id: voiceProfileId,
        post_type: postType,
        product_data_json: productData,
        content_json,
      })
      return NextResponse.json({ id: local.id, status: local.status } satisfies PostCreateResponse, { status: 201 })
    }

    const supabase = createServerClient()
    let data: unknown
    try {
      const result = await supabase
        .from('posts')
        .insert({
          voice_profile_id: voiceProfileId,
          post_type: postType,
          product_data_json: productData,
          content_json,
          status: 'draft',
        })
        .select('id, status')
        .single()

      if (result.error) return createLocalResponse()
      data = result.data
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (message.includes('fetch failed')) return createLocalResponse()
      throw err
    }

    return NextResponse.json(data as unknown as PostCreateResponse, { status: 201 })
  } catch (err) {
    const message = err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
