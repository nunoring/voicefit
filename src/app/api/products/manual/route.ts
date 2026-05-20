import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import type { ProductItem } from '@/types'

export async function POST(req: NextRequest) {
  try {
    const { post_id, items } = (await req.json()) as {
      post_id?: string
      items?: ProductItem[]
    }

    if (!post_id) return NextResponse.json({ error: 'post_id는 필수입니다.' }, { status: 400 })
    if (!items?.length) return NextResponse.json({ error: 'items는 1개 이상이어야 합니다.' }, { status: 400 })

    const supabase = createServerClient()
    const { error } = await supabase
      .from('posts')
      .update({ product_data_json: { source: 'manual', items } })
      .eq('id', post_id)

    if (error) throw new Error(error.message)

    return NextResponse.json({ ok: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
