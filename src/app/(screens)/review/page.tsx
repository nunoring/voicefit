'use client'

import { useState, useEffect, useCallback, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import type { Post, ChecklistItem, Highlight, PublishApiResult, PublishPlatform, PostType } from '@/types'
import { COMMERCE_SECTION_HEADERS, splitCommerceSections, type AuditResult, type CommerceSectionHeader } from '@/lib/commerce-pack'

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
  layout:    { id: 'fix_layout',    label: '줄넘김·문단 길이·사진 타이밍이 말투와 맞는가', category: 'content' },
}

// 글 유형별 추가 체크 항목 (현재는 커머스 패키지 전용)
const POST_TYPE_EXTRA: Record<string, Omit<ChecklistItem, 'checked'>[]> = {
  commerce_pack: [
    { id: 'disclosure_top',       label: '제휴 고지가 블로그·쇼츠설명·릴스캡션 각 상단(첫 부분)에 있는가', category: 'compliance' },
    { id: 'no_fake_usage',        label: '직접 사용하지 않은 상품을 사용 후기처럼 쓰지 않았는가',           category: 'compliance' },
    { id: 'no_fabricated_claims', label: '효능·가격·할인율·수익 등 지어낸 정보가 없는가',                  category: 'compliance' },
    { id: 'shorts_production_brief', label: '쇼츠 제작 지시서에 자막·B-roll·TTS·컷 타이밍이 있는가',       category: 'content'    },
    { id: 'youtube_insta_disclosure', label: '유튜브 설명란·인스타 캡션에도 고지가 포함됐는가',             category: 'compliance' },
    { id: 'ai_image_label',       label: 'AI 생성 이미지·가상인물을 썼다면 표시했는가',                    category: 'image'      },
    { id: 'final_human_review',   label: '발행 전 사람이 최종 검수했는가',                                category: 'content'    },
  ],
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

  for (const extra of POST_TYPE_EXTRA[post.post_type ?? ''] ?? []) {
    if (!seen.has(extra.id)) {
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

function CopyButton({ text, label = '복사' }: { text: string; label?: string }) {
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
      {copied ? '복사됨 ✓' : label}
    </button>
  )
}

// commerce_pack 전용 — 규칙 기반 정책 감사 결과. fail이면 발행 버튼을 잠근다.
function CommerceAuditPanel({
  result, loading, onRerun,
}: {
  result: AuditResult | null
  loading: boolean
  onRerun: () => void
}) {
  if (!result && !loading) return null

  const badgeCls =
    result?.overall === 'fail' ? 'bg-red-100 text-red-700' :
    result?.overall === 'warn' ? 'bg-yellow-100 text-yellow-700' :
    'bg-green-100 text-green-700'
  const badgeLabel =
    result?.overall === 'fail' ? '확인 필요' :
    result?.overall === 'warn' ? '확인 권장' :
    '이상 없음'
  const severityIcon: Record<string, string> = { fail: '🔴', warn: '🟡', pass: '🟢' }

  return (
    <div className="mb-4 rounded-lg border border-gray-200 p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">정책 감사 (규칙 기반·자동검수 아님)</p>
        <button
          type="button"
          onClick={onRerun}
          disabled={loading}
          className="text-xs text-blue-600 hover:underline disabled:opacity-50"
        >
          {loading ? '검사 중…' : '다시 검사'}
        </button>
      </div>
      {result && (
        <>
          <span className={`mb-2 inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${badgeCls}`}>{badgeLabel}</span>
          <ul className="space-y-1.5">
            {result.findings.map((f) => (
              <li key={f.id} className="flex items-start gap-1.5 text-xs text-gray-600">
                <span className="shrink-0">{severityIcon[f.severity] ?? '⚪'}</span>
                <span>{f.message}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[10px] text-gray-400">규칙 기반 자동 검사라 한계가 있습니다 — 발행 전 사람이 직접 한 번 더 확인하세요.</p>
        </>
      )}
    </div>
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

type ShortsRenderApiResult = {
  ok?: boolean
  error?: string
  video_url?: string
  durationSec?: number
  sizeBytes?: number
  plan?: {
    scenes?: unknown[]
  }
}

const SHORTS_RENDER_ENABLED = process.env.NEXT_PUBLIC_SHORTS_RENDER_ENABLED === '1'
const VOICE_SCORE_PASS = 75

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
  const [auditResult, setAuditResult] = useState<AuditResult | null>(null)
  const [auditLoading, setAuditLoading] = useState(false)

  // 포스트 로드 (postId 없으면 렌더 단계에서 바로 안내 화면으로 분기, effect는 건너뜀)
  useEffect(() => {
    if (!postId) return
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

  // 정책 감사 (commerce_pack 전용, 규칙 기반)
  const runAudit = useCallback(async () => {
    if (!postId) return
    setAuditLoading(true)
    try {
      const res = await fetch(`/api/posts/${postId}/commerce-audit`, { method: 'POST' })
      if (res.ok) setAuditResult(await res.json())
    } catch {
      // silent — 네트워크 실패가 검수 화면 진입 자체를 막지는 않게 둔다.
    } finally {
      setAuditLoading(false)
    }
  }, [postId])

  // 포스트 로드 완료 + 상품 계열(commerce_pack/product)이면 자동 1회 실행
  const auditablePostType = post?.post_type === 'commerce_pack' || post?.post_type === 'product'
  useEffect(() => {
    if (!(auditablePostType && phase === 'ready' && !auditResult && !auditLoading)) return
    const t = setTimeout(() => { runAudit() }, 0)
    return () => clearTimeout(t)
  }, [auditablePostType, phase, auditResult, auditLoading, runAudit])

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
    if (auditablePostType && auditResult?.overall === 'fail') {
      setError('정책 감사 fail 항목을 먼저 수정한 뒤 발행하세요.')
      return
    }
    // 미채점(null)도 차단 — 재생성 후 점수 리셋 상태로 발행되는 우회 방지 (서버 게이트와 동일 규칙)
    if (post?.match_score == null) {
      setError('말투 점수가 없습니다. 생성 화면에서 채점을 먼저 통과한 뒤 발행하세요.')
      return
    }
    if (post.match_score < VOICE_SCORE_PASS) {
      setError(`말투 점수가 ${VOICE_SCORE_PASS}점 미만입니다. AI티 위험이 있어 재생성 또는 수정 후 다시 채점하세요.`)
      return
    }
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
  const auditBlocked = auditablePostType && auditResult?.overall === 'fail'
  const auditPending = auditablePostType && auditLoading
  // 미채점(null)도 발행 차단 대상
  const voiceScoreBlocked = !!post && (post.match_score == null || post.match_score < VOICE_SCORE_PASS)

  // ── post_id 파라미터 없음 ──
  if (!postId) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-12">
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          post_id 파라미터가 없습니다.
        </div>
        <a href="/generate" className="mt-4 block text-center text-sm text-blue-600 hover:underline">
          ← 글 생성으로 돌아가기
        </a>
      </div>
    )
  }

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

          {/* 정책 감사 (commerce_pack / product) */}
          {auditablePostType && (
            <CommerceAuditPanel result={auditResult} loading={auditLoading} onRerun={runAudit} />
          )}

          {/* 발행 버튼 */}
          <div className="mt-4 border-t border-gray-100 pt-4">
            {/* audit fail → 발행 전 수동 확인 필요 경고 */}
            {auditablePostType && auditResult?.overall === 'fail' && phase !== 'done' && (
              <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3">
                <p className="text-xs font-semibold text-red-700">⚠️ 정책 감사에서 수정 필요 항목이 발견됐습니다</p>
                <p className="mt-0.5 text-[11px] text-red-600">위 정책 감사 결과를 수정하고 다시 검사해야 발행할 수 있습니다.</p>
              </div>
            )}
            {voiceScoreBlocked && phase !== 'done' && (
              <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3">
                <p className="text-xs font-semibold text-red-700">
                  {post?.match_score == null ? '말투 점수가 아직 없습니다' : '말투 점수가 낮습니다'}
                </p>
                <p className="mt-0.5 text-[11px] text-red-600">
                  {post?.match_score == null
                    ? '생성 화면에서 채점을 먼저 통과해야 발행할 수 있습니다. (재생성 후에는 점수가 리셋됩니다)'
                    : `AI티 위험이 있어 ${VOICE_SCORE_PASS}점 이상으로 다시 채점된 뒤 발행할 수 있습니다.`}
                </p>
              </div>
            )}
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
                disabled={isLoading || auditBlocked || auditPending || voiceScoreBlocked}
                className="w-full rounded-lg bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400"
              >
                {phase === 'publishing'
                  ? '발행 중…'
                  : voiceScoreBlocked
                  ? (post?.match_score == null ? '말투 채점 필요' : '말투 재생성 필요')
                  : auditBlocked
                  ? '정책 감사 수정 필요'
                  : auditPending
                  ? '정책 감사 확인 중…'
                  : `발행하기 ${allPassed ? '' : `(체크리스트 ${doneCount}/${items.length})`}`}
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
            <PublishResultPanel result={publishResult} activeTab={activeTab} setActiveTab={setActiveTab} postType={post?.post_type ?? null} />
          ) : (
            <BodyPreview bodyText={post?.body_text ?? ''} bodyHtml={post?.body_html} postType={post?.post_type ?? null} postId={postId} />
          )}
        </div>
      </div>
    </div>
  )
}

// 커머스 패키지 전용 — 채널/섹션별로 필요한 부분만 빠르게 복사.
// 섹션 제목이 AI 출력에서 누락/변형돼도(파싱 실패) 버튼 자체는 항상 동작하도록
// 빈 섹션은 전체 마크다운으로 폴백한다 — 절대 안 터지게.
function CommerceQuickCopy({ markdown }: { markdown: string }) {
  const sections = splitCommerceSections(markdown)
  const shorts = [sections['쇼츠 대본'], sections['쇼츠 제작 지시서'], sections['쇼츠 설명란']]
    .filter(Boolean)
    .join('\n\n')

  const buttons: { label: string; text: string }[] = [
    { label: '전체 복사', text: markdown },
    { label: '블로그만', text: sections['블로그 글'] || markdown },
    { label: '쇼츠 묶음', text: shorts || markdown },
    { label: '쇼츠 대본만', text: sections['쇼츠 대본'] || markdown },
    { label: '쇼츠 제작 지시서', text: sections['쇼츠 제작 지시서'] || markdown },
    { label: '쇼츠 설명란만', text: sections['쇼츠 설명란'] || markdown },
    { label: '릴스 캡션', text: sections['릴스 캡션'] || markdown },
    { label: 'CTA', text: sections['고정댓글 / CTA'] || markdown },
    { label: '제휴 고지', text: sections['제휴 고지'] || markdown },
    { label: '실험 가설', text: sections['실험 가설'] || markdown },
  ]

  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">빠른 복사 — 채널/섹션별</p>
      <div className="flex flex-wrap gap-1.5">
        {buttons.map(({ label, text }) => (
          <CopyButton key={label} text={text} label={label} />
        ))}
      </div>
      <p className="mt-1.5 text-[10px] text-gray-400">섹션 제목이 인식 안 되면 해당 버튼은 전체 본문으로 대체됩니다.</p>
    </div>
  )
}

type ReviewChannelId = 'blog' | 'shorts' | 'reels' | 'disclosure'

const REVIEW_CHANNELS: {
  id: ReviewChannelId
  label: string
  hint: string
  sections: CommerceSectionHeader[]
  checks: string[]
}[] = [
  {
    id: 'blog',
    label: '블로그 검수',
    hint: '첫 문단 고지, 정보성 큐레이션 톤, 과장 표현을 확인',
    sections: ['블로그 글'],
    checks: ['첫 300자 안에 제휴 고지', '직접 사용하지 않았으면 후기 표현 제거', '가격·할인율·효능은 입력값 기준'],
  },
  {
    id: 'shorts',
    label: '쇼츠 검수',
    hint: '대본, 제작 지시서, 설명란을 한 번에 확인',
    sections: ['쇼츠 대본', '쇼츠 제작 지시서', '쇼츠 설명란'],
    checks: ['0~3초 후킹이 자연스러운지', '자막·B-roll·TTS·컷 타이밍이 있는지', '설명란 첫 줄에 제휴 고지'],
  },
  {
    id: 'reels',
    label: '릴스 검수',
    hint: '짧은 캡션과 해시태그 중심으로 확인',
    sections: ['릴스 캡션'],
    checks: ['첫 줄 #광고 또는 제휴 고지', '해시태그 5개 이내', '가짜 희소성·패닉 표현 없음'],
  },
  {
    id: 'disclosure',
    label: '고지 검수',
    hint: '복사해 쓸 고지·CTA·실험 기준 확인',
    sections: ['고정댓글 / CTA', '제휴 고지', '실험 가설', '발행 전 체크리스트'],
    checks: ['고지는 숨기지 않고 명확하게', '측정 지표는 클릭·저장·댓글처럼 확인 가능하게', '발행 전 사람이 최종 확인'],
  },
]

function sectionBundle(
  sections: Partial<Record<CommerceSectionHeader, string>>,
  headers: CommerceSectionHeader[],
): string {
  return headers
    .map((header) => {
      const text = sections[header]?.trim()
      return text ? `## ${header}\n\n${text}` : ''
    })
    .filter(Boolean)
    .join('\n\n')
}

function CommerceReviewTabs({ markdown }: { markdown: string }) {
  const sections = splitCommerceSections(markdown)
  const [active, setActive] = useState<ReviewChannelId>('blog')
  const activeChannel = REVIEW_CHANNELS.find((channel) => channel.id === active) ?? REVIEW_CHANNELS[0]
  const activeText = sectionBundle(sections, activeChannel.sections)

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">채널별 검수</p>
          <p className="mt-1 text-sm text-gray-500">콘텐츠 묶음을 발행 채널 기준으로 나눠 확인합니다.</p>
        </div>
        <span className="shrink-0 rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-600">
          {Object.keys(sections).length}/{COMMERCE_SECTION_HEADERS.length}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        {REVIEW_CHANNELS.map((channel) => (
          <button
            key={channel.id}
            type="button"
            onClick={() => setActive(channel.id)}
            className={`rounded-lg border px-2 py-2 text-xs font-medium transition-colors ${
              active === channel.id
                ? 'border-blue-500 bg-blue-50 text-blue-700'
                : 'border-gray-200 text-gray-600 hover:border-gray-300'
            }`}
          >
            {channel.label}
          </button>
        ))}
      </div>

      <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
        <div className="mb-3 flex items-start justify-between gap-2">
          <div>
            <p className="text-sm font-semibold text-gray-900">{activeChannel.label}</p>
            <p className="text-xs text-gray-500">{activeChannel.hint}</p>
          </div>
          <CopyButton text={activeText || markdown} label="이 탭 복사" />
        </div>
        <ul className="mb-3 grid gap-1.5 text-xs text-gray-600 sm:grid-cols-3">
          {activeChannel.checks.map((check) => (
            <li key={check} className="rounded border border-gray-200 bg-white px-2 py-1.5">
              {check}
            </li>
          ))}
        </ul>
        <pre className="max-h-[420px] overflow-y-auto whitespace-pre-wrap rounded-lg bg-white p-3 text-sm leading-relaxed text-gray-800">
          {activeText || '이 채널에 필요한 섹션이 비어 있습니다. 원본 markdown에서 섹션 제목을 확인하세요.'}
        </pre>
      </div>

      <details className="rounded-lg border border-gray-200">
        <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-gray-500">
          전체 원본 markdown
        </summary>
        <div className="relative p-3 pt-0">
          <textarea
            readOnly
            value={markdown}
            rows={10}
            className="w-full rounded-lg border border-gray-200 bg-gray-50 p-3 font-mono text-xs leading-relaxed text-gray-700 focus:outline-none"
          />
          <div className="absolute right-5 top-2">
            <CopyButton text={markdown} />
          </div>
        </div>
      </details>
    </div>
  )
}

function formatBytes(bytes: number | undefined): string {
  if (!bytes) return ''
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

function ShortsRenderPanel({ postId }: { postId: string }) {
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<ShortsRenderApiResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cacheKey, setCacheKey] = useState(0)

  async function render() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/posts/${postId}/shorts/render`, { method: 'POST' })
      const json = await res.json() as ShortsRenderApiResult
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
      setResult(json)
      setCacheKey(Date.now())
    } catch (e) {
      setError(e instanceof Error ? e.message : '쇼츠 MP4 생성 중 오류가 발생했습니다.')
    } finally {
      setLoading(false)
    }
  }

  const videoUrl = result?.video_url ? `${result.video_url}?t=${cacheKey}` : null

  return (
    <div className="rounded-lg border border-purple-100 bg-purple-50/60 p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-purple-950">쇼츠 MP4 샘플</p>
          <p className="mt-0.5 text-xs text-purple-700">
            제작 지시서를 1080x1920 자막 영상으로 렌더합니다. 현재는 무음 텍스트 카드 MVP입니다.
          </p>
        </div>
        <button
          type="button"
          onClick={render}
          disabled={loading}
          className="rounded-md bg-purple-700 px-3 py-2 text-xs font-semibold text-white hover:bg-purple-800 disabled:cursor-not-allowed disabled:bg-gray-300"
        >
          {loading ? '생성 중...' : '쇼츠 MP4 생성'}
        </button>
      </div>

      {error && (
        <div className="mt-3 rounded-md border border-red-200 bg-white px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}

      {result?.ok && videoUrl && (
        <div className="mt-3 space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-xs text-purple-700">
            <span>{result.durationSec ?? 0}초</span>
            <span>{result.plan?.scenes?.length ?? 0}컷</span>
            {result.sizeBytes ? <span>{formatBytes(result.sizeBytes)}</span> : null}
            <a
              href={videoUrl}
              download="voicefit-shorts.mp4"
              className="rounded-md bg-white px-2.5 py-1 font-semibold text-purple-700 ring-1 ring-purple-200 hover:bg-purple-100"
            >
              MP4 다운로드
            </a>
          </div>
          <video
            src={videoUrl}
            controls
            className="aspect-[9/16] max-h-80 w-full rounded-lg bg-black object-contain"
          />
        </div>
      )}
    </div>
  )
}

function ShortsPausedPanel() {
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-gray-800">쇼츠 MP4 샘플</p>
          <p className="mt-0.5 text-xs text-gray-500">
            개발중입니다. 지금은 블로그 글 생성·검수·복사 발행 흐름을 먼저 완성합니다.
          </p>
        </div>
        <span className="rounded-md bg-white px-2.5 py-1 text-xs font-semibold text-gray-500 ring-1 ring-gray-200">
          개발중
        </span>
      </div>
    </div>
  )
}

// ── 발행 결과 패널 ─────────────────────────────────────────────────────────────

function PublishResultPanel({
  result,
  activeTab,
  setActiveTab,
  postType,
}: {
  result: PublishApiResult
  activeTab: 'html' | 'markdown'
  setActiveTab: (v: 'html' | 'markdown') => void
  postType: PostType | null
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

      {postType === 'commerce_pack' && result.markdown && (
        <CommerceQuickCopy markdown={result.markdown} />
      )}

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

function BodyPreview({
  bodyText,
  bodyHtml,
  postType,
  postId,
}: {
  bodyText: string
  bodyHtml?: string | null
  postType: PostType | null
  postId: string
}) {
  if (!bodyText) {
    return (
      <div className="flex h-full min-h-48 items-center justify-center text-sm text-gray-400">
        본문 미리보기
      </div>
    )
  }
  if (postType === 'commerce_pack') {
    return (
      <div className="space-y-3">
        {SHORTS_RENDER_ENABLED ? <ShortsRenderPanel postId={postId} /> : <ShortsPausedPanel />}
        <CommerceReviewTabs markdown={bodyText} />
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
