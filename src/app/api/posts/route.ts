import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import type { ProductData, PostType, PostCreateResponse } from '@/types'

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
    const message = err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.'
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
    }

    const { voice_profile_id, post_type, product_data, daily_content, review_place, review_experience } = body

    if (!voice_profile_id) {
      return NextResponse.json({ error: 'voice_profile_id는 필수입니다.' }, { status: 400 })
    }

    // 글 유형별 content_json 구성
    const content_json =
      post_type === 'daily' ? { daily_content } :
      post_type === 'review' ? { review_place, review_experience } :
      null

    const supabase = createServerClient()
    const { data, error } = await supabase
      .from('posts')
      .insert({
        voice_profile_id,
        post_type: post_type ?? 'product',
        product_data_json: post_type === 'product' ? (product_data ?? null) : null,
        content_json,
        status: 'draft',
      })
      .select('id, status')
      .single()

    if (error) throw new Error(error.message)

    return NextResponse.json(data as unknown as PostCreateResponse, { status: 201 })
  } catch (err) {
    const message = err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
