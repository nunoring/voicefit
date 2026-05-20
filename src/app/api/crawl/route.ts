import { NextRequest, NextResponse } from 'next/server'
import { load } from 'cheerio'
import type { CheerioAPI } from 'cheerio'

// ── 플랫폼 감지 ───────────────────────────────────────────────────────────────

type Platform = 'naver' | 'tistory' | 'blogger' | 'unknown'

function detectPlatform(url: string): Platform {
  try {
    const { hostname } = new URL(url)
    if (hostname === 'blog.naver.com' || hostname === 'm.blog.naver.com') return 'naver'
    if (hostname.endsWith('.tistory.com')) return 'tistory'
    if (hostname.endsWith('.blogspot.com') || hostname === 'blogger.com' || hostname === 'www.blogger.com') return 'blogger'
  } catch { /* invalid URL */ }
  return 'unknown'
}

// ── 네이버 URL 정규화 (데스크톱 → 모바일) ────────────────────────────────────
// 데스크톱 네이버 블로그 본문은 iframe 안에 있어 직접 파싱 불가.
// 모바일 URL이 본문 HTML을 직접 포함해 안정적으로 추출 가능.

function normalizeNaverUrl(url: string): string {
  try {
    const u = new URL(url)
    // PostView.nhn / PostView.naver 쿼리스트링 형태
    if (u.pathname.toLowerCase().includes('postview')) {
      const blogId = u.searchParams.get('blogId')
      const logNo = u.searchParams.get('logNo')
      if (blogId && logNo) return `https://m.blog.naver.com/${blogId}/${logNo}`
    }
    // /블로그아이디/글번호 경로 형태
    const parts = u.pathname.split('/').filter(Boolean)
    if (parts.length >= 2 && /^\d+$/.test(parts[1])) {
      return `https://m.blog.naver.com/${parts[0]}/${parts[1]}`
    }
    // 이미 모바일이거나 알 수 없는 형태 → 호스트만 교체
    return url.replace(/^https?:\/\/(blog|www)\.naver\.com/, 'https://m.blog.naver.com')
  } catch {
    return url
  }
}

// ── 플랫폼별 본문 컨테이너 셀렉터 ────────────────────────────────────────────
// 각 플랫폼 스킨·에디터 버전마다 클래스가 달라질 수 있으므로
// 우선순위 순서로 나열하고, 전부 실패 시 fallback 로직으로 넘어간다.

const SELECTORS: Record<Platform, string[]> = {
  naver:   ['.se-main-container', '.se_doc_viewer', '#postViewArea', '.post_ct', '.blog_content', '.se-viewer'],
  tistory: ['.entry-content', '.tt_article_useless_p_margin', '#article-view-content-div', '.contents_style', 'article'],
  blogger: ['.post-body', '.entry-content', 'article', '.post-outer'],
  unknown: ['article', 'main', '.post-content', '.entry-content', '.content', '#content', '#main'],
}

const UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'

// ── 텍스트 정리 ───────────────────────────────────────────────────────────────

function cleanText(raw: string): string {
  return raw
    .replace(/\t+/g, ' ')
    .replace(/[ ]{2,}/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// ── 이미지 필터링 ─────────────────────────────────────────────────────────────

function isJunkImage(src: string): boolean {
  if (!src || src.startsWith('data:')) return true
  if (/\/(count|pixel|track|stat|beacon|analytics|spacer|blank)\./i.test(src)) return true
  if (/[?&](type=)?(1x1|spacer|blank)/i.test(src)) return true
  return false
}

function toAbsolute(src: string, base: string): string {
  try { return new URL(src, base).href } catch { return src }
}

// ── 셀렉터 기반 추출 ──────────────────────────────────────────────────────────

function extractBySelector(
  $: CheerioAPI,
  selector: string,
  baseUrl: string,
): { text: string; images: string[] } | null {
  const el = $(selector).first()
  if (!el.length) return null

  const clone = el.clone()
  clone.find('script, style, noscript, iframe').remove()

  const text = cleanText(clone.text())
  if (text.length < 100) return null

  const images: string[] = []
  clone.find('img[src]').each((_, img) => {
    const src = $(img).attr('src') ?? ''
    if (isJunkImage(src)) return
    const abs = toAbsolute(src, baseUrl)
    if (!images.includes(abs)) images.push(abs)
  })

  return { text, images }
}

// ── 폴백: 텍스트 밀도가 가장 높은 블록 선택 ─────────────────────────────────
// 전체 div/article/section 중 (텍스트 길이 / 자식 컨테이너 수) 점수가 가장 높은
// 블록을 본문으로 간주한다.

function extractLargestBlock(
  $: CheerioAPI,
  baseUrl: string,
): { text: string; images: string[] } {
  $('script, style, noscript, nav, header, footer, aside').remove()

  let bestScore = 0
  let bestText = ''
  let bestImages: string[] = []

  $('div, article, section, main').each((_, el) => {
    const $el = $(el)
    const clone = $el.clone()
    clone.find('script, style').remove()

    const text = cleanText(clone.text())
    if (text.length < 100) return

    // 자식 컨테이너가 많을수록 "래퍼"일 가능성이 높으므로 페널티
    const childCount = clone.find('div, article, section').length
    const score = text.length / (1 + childCount * 0.15)

    if (score > bestScore) {
      bestScore = score
      bestText = text

      const imgs: string[] = []
      clone.find('img[src]').each((_, img) => {
        const src = $(img).attr('src') ?? ''
        if (isJunkImage(src)) return
        const abs = toAbsolute(src, baseUrl)
        if (!imgs.includes(abs)) imgs.push(abs)
      })
      bestImages = imgs
    }
  })

  return { text: bestText, images: bestImages }
}

// ── 라우트 핸들러 ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const { url } = (await req.json()) as { url?: string }
    if (!url?.trim()) {
      return NextResponse.json({ error: 'URL이 필요합니다.' }, { status: 400 })
    }

    const platform = detectPlatform(url.trim())
    const fetchUrl = platform === 'naver' ? normalizeNaverUrl(url.trim()) : url.trim()

    // 타임아웃 10초
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 10_000)

    let html: string
    try {
      const res = await fetch(fetchUrl, {
        signal: controller.signal,
        headers: { 'User-Agent': UA },
      })
      if (!res.ok) return NextResponse.json({ fallback: true }, { status: 503 })
      html = await res.text()
    } catch {
      // 타임아웃·네트워크 오류 — 차단 우회 없이 즉시 폴백
      return NextResponse.json({ fallback: true }, { status: 503 })
    } finally {
      clearTimeout(timer)
    }

    const $ = load(html)

    // 플랫폼 셀렉터 우선 시도
    let result: { text: string; images: string[] } | null = null
    for (const sel of SELECTORS[platform]) {
      result = extractBySelector($, sel, fetchUrl)
      if (result) break
    }

    // 셀렉터 전부 실패 시 텍스트 밀도 기반 폴백
    if (!result || result.text.length < 100) {
      result = extractLargestBlock($, fetchUrl)
    }

    if (!result || result.text.length < 100) {
      return NextResponse.json({ fallback: true }, { status: 503 })
    }

    return NextResponse.json({ text: result.text, images: result.images, platform })
  } catch {
    return NextResponse.json({ fallback: true }, { status: 503 })
  }
}
