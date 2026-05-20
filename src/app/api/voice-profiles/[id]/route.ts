import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import type { VoiceProfile } from '@/types'

export async function PATCH(req: NextRequest, ctx: RouteContext<'/api/voice-profiles/[id]'>) {
  try {
    const { id } = await ctx.params
    const { name } = await req.json() as { name?: string }
    if (!name?.trim()) return NextResponse.json({ error: '이름을 입력해주세요.' }, { status: 400 })
    const supabase = createServerClient()
    const { data, error } = await supabase
      .from('voice_profiles')
      .update({ name: name.trim() })
      .eq('id', id)
      .select()
      .single()
    if (error) throw new Error(error.message)
    return NextResponse.json(data)
  } catch (err) {
    const message = err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, ctx: RouteContext<'/api/voice-profiles/[id]'>) {
  try {
    const { id } = await ctx.params
    const supabase = createServerClient()
    const { error } = await supabase.from('voice_profiles').delete().eq('id', id)
    if (error) throw new Error(error.message)
    return NextResponse.json({ success: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function GET(_req: NextRequest, ctx: RouteContext<'/api/voice-profiles/[id]'>) {
  try {
    const { id } = await ctx.params

    const supabase = createServerClient()
    const { data, error } = await supabase
      .from('voice_profiles')
      .select('*')
      .eq('id', id)
      .single()

    if (error) {
      // PGRST116: 행 없음
      if (error.code === 'PGRST116') {
        return NextResponse.json({ error: '프로파일을 찾을 수 없습니다.' }, { status: 404 })
      }
      throw new Error(error.message)
    }

    return NextResponse.json(data as unknown as VoiceProfile)
  } catch (err) {
    const message = err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
