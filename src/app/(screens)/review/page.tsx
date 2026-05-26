'use client'

import { useState, useEffect, useCallback, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import type { Post, ChecklistItem, Highlight, PublishApiResult, PublishPlatform } from '@/types'

// ── 기본 체크리스트 항목 ──────────────────────────────────────────────────────

const DEFAULT_ITEMS: Omit<ChecklistItem, 'checked'>[] = [
  { id: 'voice_endings',  label: '내 말투 어미가 유지됐는가',          category: 'content'    },
  { id: 'not_ad',         label: '광고처럼 느껴지지 않는가',            category: 'compliance' },
  { id: 'product_info',   label: '상품 정보(가격·링크)가 정확한가',     category: 'content'    },
  { id: 'spelling',       label: '맞춤법·띄어쓰기가 맞는가',            category: 'content'    },
  { id: 'image_match',    label: '이미지가 본문 내용과 어울리는가',      category: 'image'      },
  { id: 'seo_keywords',   label: '상품명·주요 키워드가 본문에 포함됐는가', category: 'seo'      },
]

const ISSUE_EXTRA: Record<string, Omit<ChecklistItem, 'checked'>> = {
  tone:      { id: 'fix_tone',      label: '어색한 말투(tone)가 수정됐는가',           category: 'content' },
  formality: { id: 'fix_formality', label: '어체(존댓말/반말) 혼용이 정리됐는가',       category: 'content' },
  phrasing:  { id: 'fix_phrasing',  label: '어색한 표현이 수정됐는가',                 category: 'content' },
  emoji:     { id: 'fix_emoji',     label: '이모지 사용이 글 분위기에 맞는가',          category: 'content' },
}

const CATEGORY_LABEL: Record<ChecklistItem['category'], string> = {
  content:    '내용',
  seo:        'SEO',
  compliance: '규정',
  image:      '이미지',
}

function buildItems(post: Post): ChecklistItem[] {
  // 저장된 체크리스트가 있으면 재사용
  if (post.review_checklist_json?.items?.length) {
    return post.review_checklist_json.items
  }

  const base = DEFAULT_ITEMS.map((it) => ({ ...it, checked: false }))

  // score_detail의 issue_type → 추가 항목 병합
  const seen = new Set(base.map((it) => it.id))
  const issues = new Set(
    (post.score_detail_json?.highlights ?? []).map((h: Highlight) => h.issue_type),
  )
  for (const type of issues) {
    const extra = ISSUE_EXTRA[type]
    if (extra && !seen.has(extra.id)) {
      base.push({ ...extra, checked: false })
      seen.add(extra.id)
    }
  }

  return base
}

// ── 하위 컴포넌트 ────────────────────────────────────────────────────────────

function ScoreBadge({ score }: { score: number }) {
  const cls =
    score >= 80 ? 'bg-green-100 text-green-800' :
    score >= 60 ? 'bg-yellow-100 text-yellow-800' :
    'bg-red-100 text-red-700'
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${cls}`}>
      말투 일치도 {score}/100
    </span>
  )
}

function ProgressBadge({ done, total }: { done: number; total: number }) {
  const allDone = done === total && total > 0
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
      allDone ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
    }`}>
      {done}/{total} 완료
    </span>
  )
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  function copy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }
  return (
    <button
      type="button"
      onClick={copy}
      className="rounded border border-gray-200 px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50"
    >
      {copied ? '복사됨 ✓' : '복사'}
    </button>
  )
}

// 서식 그대로 복사 — text/html 클립보드로 네이버·티스토리 에디터에 포맷+이미지가 바로 붙게.
function RichCopyButton({ html, plain }: { html: string; plain: string }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([plain || html], { type: 'text/plain' }),
        }),
      ])
    } catch {
      // 일부 브라우저/비보안 컨텍스트: 서식 복사 미지원 → 평문 폴백
      await navigator.clipboard.writeText(plain || html)
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }
  return (
    <button
      type="button"
      onClick={copy}
      className="w-full rounded-lg bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
    >
      {copied ? '복사됨 ✓ — 에디터에 Ctrl+V' : '📋 서식 그대로 복사'}
    </button>
  )
}

// ── 메인 페이지 ───────────────────────────────────────────────────────────────

type Phase = 'loading' | 'ready' | 'publishing' | 'done' | 'error'

function ReviewPageInner() {
  const searchParams = useSearchParams()
  const postId = searchParams.get('post_id')

  const [phase, setPhase] = useState<Phase>('loading')
  const [post, setPost] = useState<(Post & { body_html?: string | null }) | null>(null)
  const [items, setItems] = useState<ChecklistItem[]>([])
  const [publishResult, setPublishResult] = useState<PublishApiResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'html' | 'markdown'>('html')
  const [platform, setPlatform] = useState<PublishPlatform>('naver')
  const [tistoryUrl, setTistoryUrl] = useState('')

  // 포스트 로드
  useEffect(() => {
    if (!postId) { setPhase('error'); setError('post_id 파라미터가 없습니다.'); return }
    fetch(`/api/posts/${postId}`)
      .then((r) => r.json())
      .then((data: Post & { error?: string }) => {
        if (data.error) throw new Error(data.error)
        setPost(data)
        setItems(buildItems(data))
        setPhase('ready')
      })
      .catch((e: Error) => {
        setError(e.message)
        setPhase('error')
      })
  }, [postId])

  // 체크박스 토글 + 서버 저장
  const toggleItem = useCallback(
    async (id: string) => {
      if (!postId || phase !== 'ready') return
      const next = items.map((it) =>
        it.id === id ? { ...it, checked: !it.checked } : it,
      )
      setItems(next)
      // fire-and-forget 저장 (UI는 낙관적 업데이트)
      fetch(`/api/posts/${postId}/checklist`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: next }),
      }).catch(() => {/* silent */})
    },
    [items, postId, phase],
  )

  async function handlePublish() {
    if (!postId) return
    setPhase('publishing')
    try {
      const res = await fetch(`/api/posts/${postId}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform, tistory_url: tistoryUrl || undefined }),
      })
      const json: PublishApiResult & { error?: string } = await res.json()

      if (res.status === 422) {
        setError(json.error ?? '체크리스트를 모두 완료해주세요.')
        setPhase('ready')
        return
      }
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)

      setPublishResult(json)
      setPhase('done')
    } catch (e) {
      setError(e instanceof Error ? e.message : '발행 중 오류가 발생했습니다.')
      setPhase('ready')
    }
  }

  const doneCount = items.filter((it) => it.checked).length
  const allPassed = doneCount === items.length && items.length > 0
  const isLoading = phase === 'loading' || phase === 'publishing'

  // ── 로딩 ──
  if (phase === 'loading') {
    return (
      <div className="mx-auto max-w-4xl px-4 py-16 text-center text-sm text-gray-400">
        포스트 로딩 중…
      </div>
    )
  }

  // ── 에러 ──
  if (phase === 'error' && !post) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-12">
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error ?? '알 수 없는 오류가 발생했습니다.'}
        </div>
        <a
          href="/generate"
          className="mt-4 block text-center text-sm text-blue-600 hover:underline"
        >
          ← 글 생성으로 돌아가기
        </a>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      {/* 헤더 */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">검수</h1>
          <p className="mt-1 text-sm text-gray-500">
            모든 항목을 확인한 후 발행하세요.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {post?.match_score != null && <ScoreBadge score={post.match_score} />}
          <ProgressBadge done={doneCount} total={items.length} />
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* 왼쪽: 체크리스트 */}
        <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
          <p className="mb-4 text-xs font-semibold uppercase tracking-wide text-gray-500">
            위화감 체크리스트
          </p>

          {/* 카테고리별 그룹 */}
          {(['content', 'seo', 'compliance', 'image'] as ChecklistItem['category'][]).map((cat) => {
            const catItems = items.filter((it) => it.category === cat)
            if (!catItems.length) return null
            return (
              <div key={cat} className="mb-5">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                  {CATEGORY_LABEL[cat]}
                </p>
                <ul className="space-y-2">
                  {catItems.map((item) => (
                    <li key={item.id}>
                      <label className="flex cursor-pointer items-start gap-3 rounded-lg p-2 transition-colors hover:bg-gray-50">
                        <input
                          type="checkbox"
                          checked={item.checked}
                          onChange={() => toggleItem(item.id)}
                          disabled={isLoading || phase === 'done'}
                          className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:cursor-not-allowed"
                        />
                        <span
                          className={`text-sm leading-snug ${
                            item.checked ? 'text-gray-400 line-through' : 'text-gray-700'
                          }`}
                        >
                          {item.label}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}

          {/* 발행 버튼 */}
          <div className="mt-4 border-t border-gray-100 pt-4">
            {phase !== 'done' && (
              <div className="mb-3 space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">어디에 발행할까요?</p>
                <div className="flex gap-2">
                  {([
                    { value: 'naver',   label: '네이버 블로그' },
                    { value: 'tistory', label: '티스토리' },
                    { value: 'manual',  label: '직접 복붙' },
                  ] as { value: PublishPlatform; label: string }[]).map(({ value, label }) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setPlatform(value)}
                      disabled={isLoading}
                      className={`flex-1 rounded-lg border py-2 text-xs font-medium transition-colors ${
                        platform === value
                          ? 'border-blue-500 bg-blue-50 text-blue-700'
                          : 'border-gray-200 text-gray-600 hover:border-gray-300'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {platform === 'tistory' && (
                  <input
                    type="url"
                    value={tistoryUrl}
                    onChange={(e) => setTistoryUrl(e.target.value)}
                    placeholder="티스토리 블로그 주소 (예: myblog.tistory.com)"
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-xs placeholder:text-gray-400 focus:border-blue-400 focus:outline-none"
                  />
                )}
              </div>
            )}
            {phase !== 'done' ? (
              <button
                type="button"
                onClick={handlePublish}
                disabled={isLoading}
                className="w-full rounded-lg bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400"
              >
                {phase === 'publishing' ? '발행 중…' : `발행하기 ${allPassed ? '' : `(체크리스트 ${doneCount}/${items.length})`}`}
              </button>
            ) : (
              <div className="flex items-center justify-center gap-2 rounded-lg bg-green-50 px-4 py-3">
                <span className="text-sm font-semibold text-green-700">✓ 발행 완료</span>
              </div>
            )}

            <a
              href={`/generate${post?.voice_profile_id ? `?voice_profile_id=${post.voice_profile_id}` : ''}`}
              className="mt-3 block text-center text-xs text-gray-400 hover:text-gray-600 hover:underline"
            >
              ← 글 수정으로 돌아가기
            </a>
          </div>
        </div>

        {/* 오른쪽: 결과 / 본문 미리보기 */}
        <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
          {phase === 'done' && publishResult ? (
            <PublishResultPanel result={publishResult} activeTab={activeTab} setActiveTab={setActiveTab} />
          ) : (
            <BodyPreview bodyText={post?.body_text ?? ''} bodyHtml={post?.body_html} />
          )}
        </div>
      </div>
    </div>
  )
}

// ── 발행 결과 패널 ─────────────────────────────────────────────────────────────

function PublishResultPanel({
  result,
  activeTab,
  setActiveTab,
}: {
  result: PublishApiResult
  activeTab: 'html' | 'markdown'
  setActiveTab: (v: 'html' | 'markdown') => void
}) {
  if (result.published && result.naver_post_url) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 py-8 text-center">
        <div className="text-4xl">🎉</div>
        <p className="text-lg font-bold text-gray-900">네이버 블로그에 발행됐습니다!</p>
        <a
          href={result.naver_post_url}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-lg bg-green-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-green-700"
        >
          발행된 글 보기 →
        </a>
        <p className="text-xs text-gray-400 break-all">{result.naver_post_url}</p>
      </div>
    )
  }

  // 복사 발행 (반자동) — 서식 그대로 에디터에 붙여넣기
  const sourceContent = activeTab === 'html' ? (result.html ?? '') : (result.markdown ?? '')

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
        완성된 글이에요. <b>서식 그대로 복사</b> 후 네이버·티스토리 글쓰기에 <b>Ctrl+V</b>로 붙여넣으면 끝.
      </div>

      <RichCopyButton html={result.html ?? ''} plain={result.markdown ?? ''} />

      <p className="text-[11px] leading-relaxed text-gray-400">
        제목·본문·서식은 그대로 붙습니다. 이미지는 <b>티스토리</b>는 대체로 함께 붙고,
        <b>네이버</b>는 내가 찍은 사진을 다시 끌어다 넣어야 할 수 있어요 (사진은 이미 내 PC에 있으니 금방).
      </p>

      {/* 원본 소스 (티스토리 HTML 모드 등 고급용) */}
      <details className="rounded-lg border border-gray-200">
        <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-gray-500">
          원본 소스 (HTML / 마크다운) — 고급
        </summary>
        <div className="space-y-2 p-3 pt-0">
          <div className="flex gap-1 rounded-lg bg-gray-100 p-1">
            {(['html', 'markdown'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={`flex-1 rounded-md py-1.5 text-xs font-medium transition-colors ${
                  activeTab === tab
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {tab.toUpperCase()}
              </button>
            ))}
          </div>
          <div className="relative">
            <textarea
              readOnly
              value={sourceContent}
              rows={12}
              className="w-full rounded-lg border border-gray-200 bg-gray-50 p-3 font-mono text-xs leading-relaxed text-gray-700 focus:outline-none"
            />
            <div className="absolute right-2 top-2">
              <CopyButton text={sourceContent} />
            </div>
          </div>
        </div>
      </details>
    </div>
  )
}

// ── 본문 미리보기 ─────────────────────────────────────────────────────────────

function BodyPreview({ bodyText, bodyHtml }: { bodyText: string; bodyHtml?: string | null }) {
  if (!bodyText) {
    return (
      <div className="flex h-full min-h-48 items-center justify-center text-sm text-gray-400">
        본문 미리보기
      </div>
    )
  }
  return (
    <div>
      <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
        본문 미리보기
      </p>
      {bodyHtml ? (
        // body_html이 있으면 실제 이미지 포함 렌더링 (서버에서 변환, 클라이언트 파서 없음)
        <div
          className="prose prose-sm max-h-[520px] max-w-none overflow-y-auto rounded-lg bg-gray-50 p-4 text-sm leading-relaxed text-gray-700 [&_img]:my-3 [&_img]:max-w-full [&_img]:rounded [&_h1]:mb-2 [&_h1]:text-xl [&_h1]:font-bold [&_h2]:mb-1 [&_h2]:text-lg [&_h2]:font-bold [&_h3]:font-semibold [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_p]:mb-2"
          // body_html은 자체 서버에서 생성한 HTML이므로 XSS 위험 없음
          dangerouslySetInnerHTML={{ __html: bodyHtml }}
        />
      ) : (
        <pre className="max-h-[520px] overflow-y-auto whitespace-pre-wrap rounded-lg bg-gray-50 p-4 text-sm leading-relaxed text-gray-700">
          {bodyText}
        </pre>
      )}
    </div>
  )
}

// ── 페이지 진입점 ─────────────────────────────────────────────────────────────

export default function ReviewPage() {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-gray-400">로딩 중…</div>}>
      <ReviewPageInner />
    </Suspense>
  )
}
