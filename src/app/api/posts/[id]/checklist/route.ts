import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import type { ChecklistItem } from '@/types'

export async function PATCH(
  req: NextRequest,
  ctx: RouteContext<'/api/posts/[id]/checklist'>,
) {
  try {
    const { id } = await ctx.params
    const { items } = (await req.json()) as { items?: ChecklistItem[] }

    if (!Array.isArray(items)) {
      return NextResponse.json({ error: 'items 배열이 필요합니다.' }, { status: 400 })
    }

    const all_passed = items.length > 0 && items.every((it) => it.checked)
    const review_checklist_json = { all_passed, items }

    const supabase = createServerClient()
    const { error } = await supabase
      .from('posts')
      .update({ review_checklist_json, status: 'reviewing' })
      .eq('id', id)

    if (error) throw new Error(error.message)

    return NextResponse.json({ all_passed, items })
  } catch (err) {
    const message = err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
