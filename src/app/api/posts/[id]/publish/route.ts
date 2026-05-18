import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { markdownToHtml, buildImageUrlMap } from '@/lib/markdown'
import type { Post, PublishApiResult } from '@/types'

// ── 라우트 핸들러 ─────────────────────────────────────────────────────────────

export async function POST(
  _req: NextRequest,
  ctx: RouteContext<'/api/posts/[id]/publish'>,
) {
  try {
    const { id } = await ctx.params
    const supabase = createServerClient()

    const { data: postData, error: postErr } = await supabase
      .from('posts')
      .select('body_text, review_checklist_json, match_score')
      .eq('id', id)
      .single()

    if (postErr) throw new Error(postErr.message)

    const post = postData as unknown as Pick<Post, 'body_text' | 'review_checklist_json' | 'match_score'>

    // 발행 게이트: 체크리스트 미완성 차단 (422는 어떤 경우에도 유지)
    if (!post.review_checklist_json?.all_passed) {
      return NextResponse.json(
        { error: '체크리스트를 모두 완료한 후 발행할 수 있습니다.' },
        { status: 422 },
      )
    }

    if (!post.body_text) throw new Error('발행할 본문이 없습니다.')

    // 이미지 URL 맵: placement_index 오름차순 → created_at 오름차순으로 정렬된 배열을
    // 그대로 1..N 순번으로 매핑. 저장된 placement_index 값은 사용하지 않음.
    const { data: imgRows } = await supabase
      .from('post_images')
      .select('public_url, placement_index')
      .eq('post_id', id)
      .order('placement_index', { ascending: true })
      .order('created_at', { ascending: true })

    const imageUrls = buildImageUrlMap((imgRows ?? []) as { public_url: string }[])
    const html  = markdownToHtml(post.body_text, imageUrls)
    const title = (post.body_text.split('\n').find((l) => l.trim()) ?? '')
      .replace(/^#+\s*/, '')
      .slice(0, 80)

    // ── Playwright 자동 포스팅 시도 (로컬 전용, 환경변수 활성화 시) ──────────
    if (process.env.ALLOW_NAVER_AUTOMATION === '1' && !process.env.VERCEL) {
      try {
        const { publishToNaver } = await import('@/lib/naver-publisher')
        const naverResult = await publishToNaver({ title, bodyHtml: html })

        if (naverResult.ok) {
          await supabase
            .from('posts')
            .update({ naver_post_url: naverResult.url, status: 'published' })
            .eq('id', id)

          const result: PublishApiResult = {
            published: true,
            naver_post_url: naverResult.url,
            status: 'published',
          }
          return NextResponse.json(result)
        }
        console.warn('[publish] Playwright 자동 포스팅 실패:', naverResult.reason)
      } catch (playwrightErr) {
        console.warn('[publish] Playwright 임포트/실행 오류:', playwrightErr)
      }
    }

    // 폴백: HTML + 마크다운 반환 (사용자 직접 붙여넣기)
    await supabase
      .from('posts')
      .update({ status: 'published' })
      .eq('id', id)

    const result: PublishApiResult = {
      published: false,
      html,
      markdown: post.body_text,
      status: 'published',
    }
    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
