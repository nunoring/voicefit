import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'

export async function POST(
  req: NextRequest,
  ctx: RouteContext<'/api/posts/[id]/images/upload'>,
) {
  try {
    const { id } = await ctx.params
    const formData = await req.formData()
    const file = formData.get('file') as File | null

    if (!file) return NextResponse.json({ error: '파일이 없습니다.' }, { status: 400 })

    const ext = file.name.split('.').pop() ?? 'bin'
    const storagePath = `${id}/${Date.now()}.${ext}`
    const bytes = await file.arrayBuffer()

    const supabase = createServerClient()

    const { error: uploadErr } = await supabase.storage
      .from('post-images')
      .upload(storagePath, bytes, { contentType: file.type, upsert: false })

    if (uploadErr) throw new Error(uploadErr.message)

    const { data: { publicUrl } } = supabase.storage
      .from('post-images')
      .getPublicUrl(storagePath)

    const { data: row, error: insertErr } = await supabase
      .from('post_images')
      .insert({
        post_id: id,
        source_type: 'user_uploaded',
        storage_path: storagePath,
        public_url: publicUrl,
      })
      .select('id, public_url, storage_path')
      .single()

    if (insertErr) throw new Error(insertErr.message)

    return NextResponse.json(row, { status: 201 })
  } catch (err) {
    const message = err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
