import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { auditCommercePack, auditPlainPost } from '@/lib/commerce-pack'
import { getLocalPost } from '@/lib/local-posts'

/**
 * 규칙 기반 정책 감사. AI 호출 없음 — 정규식/문자열 검사만.
 * commerce_pack: 9섹션 구조·고지 위치까지 감사 / product: 체험담·과장 표현만 평문 감사.
 * 클라이언트는 fail 결과를 발행 전 수정 게이트로 사용한다.
 */
function runAuditByType(postType: string | null, bodyText: string, usageBasis: string | null | undefined) {
  if (postType === 'commerce_pack') return auditCommercePack(bodyText, usageBasis ?? null)
  if (postType === 'product') return auditPlainPost(bodyText, usageBasis ?? 'curation')
  return null
}
export async function POST(
  _req: NextRequest,
  ctx: RouteContext<'/api/posts/[id]/commerce-audit'>,
) {
  try {
    const { id } = await ctx.params
    if (id.startsWith('local_post_')) {
      const post = await getLocalPost(id)
      if (!post) {
        return NextResponse.json({ error: '포스트를 찾을 수 없습니다.' }, { status: 404 })
      }
      if (!post.body_text) throw new Error('감사할 본문이 없습니다.')

      const result = runAuditByType(post.post_type, post.body_text, post.content_json?.usage_basis)
      if (!result) {
        return NextResponse.json({ error: '정책 감사는 commerce_pack / product 글에만 적용됩니다.' }, { status: 400 })
      }
      return NextResponse.json(result)
    }

    const supabase = createServerClient()

    const { data: post, error: postErr } = await supabase
      .from('posts')
      .select('body_text, post_type, content_json')
      .eq('id', id)
      .single()

    if (postErr) throw new Error(postErr.message)

    const row = post as unknown as {
      body_text: string | null
      post_type: string | null
      content_json: { usage_basis?: string } | null
    }

    if (!row.body_text) throw new Error('감사할 본문이 없습니다.')

    const result = runAuditByType(row.post_type, row.body_text, row.content_json?.usage_basis)
    if (!result) {
      return NextResponse.json({ error: '정책 감사는 commerce_pack / product 글에만 적용됩니다.' }, { status: 400 })
    }

    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
