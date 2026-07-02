import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { markdownToHtml, buildImageUrlMap, appendLegalDisclosureIfNeeded } from '@/lib/markdown'
import { getLocalPost, updateLocalPost } from '@/lib/local-posts'
import { listLocalPostImages } from '@/lib/local-post-images'
import type { Post, PublishApiResult, PublishPlatform } from '@/types'

const VOICE_SCORE_PASS = 75

// ── 라우트 핸들러 ─────────────────────────────────────────────────────────────

export async function POST(
  req: NextRequest,
  ctx: RouteContext<'/api/posts/[id]/publish'>,
) {
  try {
    const { id } = await ctx.params
    // 사람이 검수 화면에서 고른 발행 채널 — 이전엔 요청 바디를 안 읽어서 항상 무시됐음(기존 버그, 이번에 수정).
    const { platform, tistory_url } = await req.json().catch(() => ({})) as { platform?: PublishPlatform; tistory_url?: string }

    if (id.startsWith('local_post_')) {
      const post = await getLocalPost(id)
      if (!post) {
        return NextResponse.json({ error: '포스트를 찾을 수 없습니다.' }, { status: 404 })
      }
      if (!post.body_text) throw new Error('발행할 본문이 없습니다.')
      if (post.match_score != null && post.match_score < VOICE_SCORE_PASS) {
        return NextResponse.json(
          { error: `말투 점수가 ${VOICE_SCORE_PASS}점 미만입니다. AI티 위험이 있어 재생성 또는 수정 후 다시 채점하세요.` },
          { status: 422 },
        )
      }

      const imageUrls = buildImageUrlMap(await listLocalPostImages(id))
      const rawHtml = markdownToHtml(post.body_text, imageUrls)
      const html = appendLegalDisclosureIfNeeded(rawHtml, post.body_text, post.post_type)
      const published_url = platform === 'tistory' ? (tistory_url || undefined) : undefined
      await updateLocalPost(id, {
        status: 'published',
        publish_platform: platform ?? null,
        published_url: published_url ?? null,
      })

      const result: PublishApiResult = {
        published: false,
        html,
        markdown: post.body_text,
        platform,
        published_url,
        status: 'published',
      }
      return NextResponse.json(result)
    }

    const supabase = createServerClient()

    const { data: postData, error: postErr } = await supabase
      .from('posts')
      .select('body_text, review_checklist_json, match_score, post_type')
      .eq('id', id)
      .single()

    if (postErr) throw new Error(postErr.message)

    const post = postData as unknown as Pick<Post, 'body_text' | 'review_checklist_json' | 'match_score' | 'post_type'>

    if (!post.body_text) throw new Error('발행할 본문이 없습니다.')
    if (post.match_score != null && post.match_score < VOICE_SCORE_PASS) {
      return NextResponse.json(
        { error: `말투 점수가 ${VOICE_SCORE_PASS}점 미만입니다. AI티 위험이 있어 재생성 또는 수정 후 다시 채점하세요.` },
        { status: 422 },
      )
    }

    // 이미지 URL 맵: placement_index 오름차순 → created_at 오름차순으로 정렬된 배열을
    // 그대로 1..N 순번으로 매핑. 저장된 placement_index 값은 사용하지 않음.
    const { data: imgRows } = await supabase
      .from('post_images')
      .select('public_url, placement_index')
      .eq('post_id', id)
      .order('placement_index', { ascending: true })
      .order('created_at', { ascending: true })

    const imageUrls = buildImageUrlMap((imgRows ?? []) as { public_url: string }[])
    const rawHtml = markdownToHtml(post.body_text, imageUrls)
    // 쿠팡 파트너스 법적 공시는 product/commerce_pack에 추가 (본문에 이미 있으면 중복 삽입 안 함)
    const html = appendLegalDisclosureIfNeeded(rawHtml, post.body_text, post.post_type)
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
            .update({ naver_post_url: naverResult.url, publish_platform: 'naver', published_url: naverResult.url, status: 'published' })
            .eq('id', id)

          const result: PublishApiResult = {
            published: true,
            naver_post_url: naverResult.url,
            published_url: naverResult.url,
            platform: 'naver',
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
    // published_url: 실제 게시물 URL은 알 수 없음(직접 붙여넣기라서) — 티스토리는 블로그 주소까지만 기록.
    const published_url = platform === 'tistory' ? (tistory_url || undefined) : undefined
    await supabase
      .from('posts')
      .update({ status: 'published', publish_platform: platform ?? null, published_url: published_url ?? null })
      .eq('id', id)

    const result: PublishApiResult = {
      published: false,
      html,
      markdown: post.body_text,
      platform,
      published_url,
      status: 'published',
    }
    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
