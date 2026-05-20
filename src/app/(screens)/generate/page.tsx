'use client'

import { useState, useRef, useCallback, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import type { PostType, ProductItem, ScoreApiResult, Highlight } from '@/types'

// ── 타입 ─────────────────────────────────────────────────────────────────────

interface ManualItem {
  name: string
  price: string
  url: string
  image_url: string
}

interface ReviewContent {
  place: string
  experience: string
}

type LoadingStep = 'idle' | 'creating' | 'uploading' | 'sourcing' | 'generating' | 'scoring' | 'regenerating'

const STEP_LABELS: Record<LoadingStep, string> = {
  idle: '',
  creating: '포스트 초안 생성 중…',
  uploading: '이미지 업로드 및 해석 중…',
  sourcing: '이미지 소싱 중…',
  generating: '본문 생성 중…',
  scoring: '말투 일치도 채점 중…',
  regenerating: '재생성 중…',
}

const POST_TYPES: { type: PostType; icon: string; label: string; desc: string }[] = [
  { type: 'product', icon: '🛍️', label: '상품 리뷰', desc: '쿠팡, 오늘의집, 올리브영 등' },
  { type: 'daily',   icon: '☀️', label: '일상 기록', desc: '오늘 있었던 일, 생각' },
  { type: 'review',  icon: '⭐', label: '경험 리뷰', desc: '카페, 맛집, 장소 후기' },
]

function emptyItem(): ManualItem {
  return { name: '', price: '', url: '', image_url: '' }
}

// ── 하위 컴포넌트 ────────────────────────────────────────────────────────────

function ProgressBar({ step }: { step: LoadingStep }) {
  if (step === 'idle') return null
  return (
    <div className="mb-4">
      <div className="mb-1 flex justify-between text-xs text-gray-500">
        <span>{STEP_LABELS[step]}</span>
        <span className="animate-pulse">잠시만 기다려주세요</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
        <div className="h-full animate-[indeterminate_1.5s_ease-in-out_infinite] rounded-full bg-blue-500" />
      </div>
    </div>
  )
}

function ScoreBadge({ score }: { score: number }) {
  const color =
    score >= 80 ? 'bg-green-100 text-green-800' :
    score >= 60 ? 'bg-yellow-100 text-yellow-800' :
    'bg-red-100 text-red-700'
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-sm font-semibold ${color}`}>
      말투 일치도 {score}/100
    </span>
  )
}

function HighlightList({ highlights }: { highlights: Highlight[] }) {
  if (!highlights.length) return null
  const typeLabel: Record<string, string> = {
    tone: '말투', formality: '어체', phrasing: '표현', emoji: '이모지',
  }
  return (
    <ul className="space-y-2">
      {highlights.map((h, i) => (
        <li key={i} className="rounded-lg border border-amber-100 bg-amber-50 p-3 text-sm">
          <div className="flex items-start gap-2">
            <span className="mt-0.5 shrink-0 rounded bg-amber-200 px-1.5 py-0.5 text-xs font-medium text-amber-800">
              {typeLabel[h.issue_type] ?? h.issue_type}
            </span>
            <div>
              <p className="font-medium text-gray-800">"{h.text}"</p>
              <p className="mt-0.5 text-gray-600">→ {h.suggestion}</p>
            </div>
          </div>
        </li>
      ))}
    </ul>
  )
}

// ── 왼쪽 패널 ────────────────────────────────────────────────────────────────

function LeftPanel({
  postType, setPostType,
  manualItems, setManualItems,
  dailyContent, setDailyContent,
  reviewContent, setReviewContent,
  imageFiles, setImageFiles,
  onGenerate, loadingStep,
}: {
  postType: PostType
  setPostType: (v: PostType) => void
  manualItems: ManualItem[]
  setManualItems: (v: ManualItem[]) => void
  dailyContent: string
  setDailyContent: (v: string) => void
  reviewContent: ReviewContent
  setReviewContent: (v: ReviewContent) => void
  imageFiles: File[]
  setImageFiles: (v: File[]) => void
  onGenerate: () => void
  loadingStep: LoadingStep
}) {
  const [isDragging, setIsDragging] = useState(false)
  const [isFetching, setIsFetching] = useState(false)
  const [fetchUrl, setFetchUrl] = useState('')
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [imageSourcingStatus, setImageSourcingStatus] = useState<'idle' | 'success' | 'fail'>('idle')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const isLoading = loadingStep !== 'idle'

  async function handleFetchProduct() {
    const url = fetchUrl.trim()
    if (!url) return
    setIsFetching(true)
    setFetchError(null)
    try {
      const res = await fetch('/api/products/fetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'auto', query_or_url: url }),
      })
      const json = await res.json()
      if (res.status === 503 || json.fallback || !res.ok) {
        setFetchError('자동 가져오기 실패. 아래에 직접 입력해주세요.')
        return
      }
      const items: ProductItem[] = json.items ?? []
      setManualItems(items.map((it) => ({
        name: it.name,
        price: String(it.price ?? ''),
        url: it.url ?? url,
        image_url: it.image_url ?? '',
      })))
      setFetchUrl('')
    } catch {
      setFetchError('가져오기 실패. 직접 입력해주세요.')
    } finally {
      setIsFetching(false)
    }
  }

  function updateItem(idx: number, field: keyof ManualItem, val: string) {
    setManualItems(manualItems.map((it, i) => i === idx ? { ...it, [field]: val } : it))
  }

  function handleFiles(files: FileList | null) {
    if (!files) return
    setImageFiles([...imageFiles, ...Array.from(files)])
    setImageSourcingStatus('idle')
  }

  const canGenerate = !isLoading && (() => {
    if (postType === 'product') return manualItems.some((it) => it.name.trim())
    if (postType === 'daily') return dailyContent.trim().length >= 10
    if (postType === 'review') return reviewContent.place.trim().length >= 2
    return false
  })()

  return (
    <div className="space-y-5">
      {/* 글 유형 선택 */}
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">어떤 글 쓸까요?</p>
        <div className="grid grid-cols-3 gap-2">
          {POST_TYPES.map(({ type, icon, label, desc }) => (
            <button
              key={type}
              type="button"
              onClick={() => setPostType(type)}
              disabled={isLoading}
              className={`rounded-lg border p-3 text-left transition-colors ${
                postType === type
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <span className="text-xl">{icon}</span>
              <p className={`mt-1 text-xs font-semibold ${postType === type ? 'text-blue-700' : 'text-gray-700'}`}>{label}</p>
              <p className="text-[10px] text-gray-400">{desc}</p>
            </button>
          ))}
        </div>
      </div>

      {/* 글 유형별 입력 */}
      {postType === 'product' && (
        <div className="space-y-3">
          {/* URL 가져오기 */}
          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">상품 URL로 자동 입력</p>
            <div className="flex gap-2">
              <input
                type="url"
                value={fetchUrl}
                onChange={(e) => { setFetchUrl(e.target.value); setFetchError(null) }}
                onKeyDown={(e) => e.key === 'Enter' && handleFetchProduct()}
                disabled={isFetching || isLoading}
                placeholder="쿠팡, 오늘의집, 올리브영 등 어떤 URL이든"
                className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm placeholder:text-gray-400 focus:border-blue-500 focus:outline-none disabled:bg-gray-50"
              />
              <button
                type="button"
                onClick={handleFetchProduct}
                disabled={!fetchUrl.trim() || isFetching || isLoading}
                className="rounded-lg bg-gray-700 px-4 py-2 text-sm font-medium text-white hover:bg-gray-600 disabled:bg-gray-200 disabled:text-gray-500"
              >
                {isFetching ? '가져오는 중…' : '가져오기'}
              </button>
            </div>
            {fetchError && <p className="mt-1.5 text-xs text-yellow-700">{fetchError}</p>}
          </div>

          {/* 상품 목록 */}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">상품 목록</p>
              <button type="button" onClick={() => setManualItems([...manualItems, emptyItem()])} className="text-xs text-blue-600 hover:underline">
                + 추가
              </button>
            </div>
            <div className="space-y-2">
              {manualItems.map((item, idx) => (
                <div key={idx} className="rounded-lg border border-gray-200 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-medium text-gray-500">상품 {idx + 1}</span>
                    {manualItems.length > 1 && (
                      <button type="button" onClick={() => setManualItems(manualItems.filter((_, i) => i !== idx))} className="text-xs text-red-400 hover:text-red-600">삭제</button>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    {([
                      { field: 'name', placeholder: '상품명 *' },
                      { field: 'price', placeholder: '가격 (숫자)' },
                      { field: 'url', placeholder: '상품 URL (어필리에이트 링크)' },
                    ] as { field: keyof ManualItem; placeholder: string }[]).map(({ field, placeholder }) => (
                      <input
                        key={field}
                        type="text"
                        value={item[field]}
                        onChange={(e) => updateItem(idx, field, e.target.value)}
                        placeholder={placeholder}
                        disabled={isLoading}
                        className="w-full rounded border border-gray-200 px-2.5 py-1.5 text-xs placeholder:text-gray-400 focus:border-blue-400 focus:outline-none disabled:bg-gray-50"
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {postType === 'daily' && (
        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500">
            오늘 어떤 일이 있었나요?
          </label>
          <textarea
            value={dailyContent}
            onChange={(e) => setDailyContent(e.target.value)}
            disabled={isLoading}
            rows={6}
            placeholder="키워드나 메모 수준도 괜찮아요. 예: 오늘 친구랑 성수 카페 갔다가 기분 좋았음. 날씨 너무 좋았고 커피가 맛있었어"
            className="w-full rounded-lg border border-gray-300 p-3 text-sm placeholder:text-gray-400 focus:border-blue-500 focus:outline-none disabled:bg-gray-50"
          />
          <p className="mt-1 text-right text-xs text-gray-400">{dailyContent.length}자</p>
        </div>
      )}

      {postType === 'review' && (
        <div className="space-y-3">
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500">장소 / 서비스 이름</label>
            <input
              type="text"
              value={reviewContent.place}
              onChange={(e) => setReviewContent({ ...reviewContent, place: e.target.value })}
              disabled={isLoading}
              placeholder="예: 성수동 카페 어니언, 강남 스시 오마카세"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm placeholder:text-gray-400 focus:border-blue-500 focus:outline-none disabled:bg-gray-50"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500">경험 메모</label>
            <textarea
              value={reviewContent.experience}
              onChange={(e) => setReviewContent({ ...reviewContent, experience: e.target.value })}
              disabled={isLoading}
              rows={5}
              placeholder="느낀 점, 특이한 점, 추천 메뉴 등 자유롭게"
              className="w-full rounded-lg border border-gray-300 p-3 text-sm placeholder:text-gray-400 focus:border-blue-500 focus:outline-none disabled:bg-gray-50"
            />
          </div>
        </div>
      )}

      {/* 이미지 첨부 */}
      <div>
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">이미지 첨부</p>
        <p className="mb-2 text-[11px] text-gray-400">
          {postType === 'product'
            ? '첨부하지 않으면 스톡 이미지를 자동 소싱합니다.'
            : '직접 찍은 사진을 첨부하세요. 없으면 텍스트만 생성됩니다.'}
        </p>
        {imageSourcingStatus === 'fail' && (
          <p className="mb-1.5 rounded-lg bg-yellow-50 px-3 py-1.5 text-[11px] text-yellow-700">
            자동 이미지 소싱에 실패했어요. 직접 첨부하거나 텍스트만 생성됩니다.
          </p>
        )}
        <div
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => { e.preventDefault(); setIsDragging(false); handleFiles(e.dataTransfer.files) }}
          className={`flex cursor-pointer items-center justify-center rounded-lg border-2 border-dashed px-4 py-5 text-sm transition-colors ${
            isDragging ? 'border-blue-400 bg-blue-50 text-blue-500' : 'border-gray-200 text-gray-400 hover:border-blue-300 hover:text-blue-500'
          }`}
        >
          {isDragging ? '여기에 놓으세요' : '클릭하거나 드래그해서 이미지 첨부'}
        </div>
        <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => handleFiles(e.target.files)} />
        {imageFiles.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {imageFiles.map((f, i) => (
              <div key={i} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={URL.createObjectURL(f)} alt={f.name} className="h-16 w-16 rounded object-cover" />
                <button
                  type="button"
                  onClick={() => setImageFiles(imageFiles.filter((_, j) => j !== i))}
                  className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] text-white"
                >×</button>
              </div>
            ))}
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={onGenerate}
        disabled={!canGenerate}
        className="w-full rounded-lg bg-blue-600 px-4 py-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-500"
      >
        {isLoading ? '생성 중…' : '글 생성하기'}
      </button>
    </div>
  )
}

// ── 오른쪽 패널 ───────────────────────────────────────────────────────────────

function RightPanel({
  loadingStep, bodyText, setBodyText, scoreResult,
  feedback, setFeedback, onRegenerate, onMoveToReview,
}: {
  loadingStep: LoadingStep
  bodyText: string
  setBodyText: (v: string) => void
  scoreResult: ScoreApiResult | null
  feedback: string
  setFeedback: (v: string) => void
  onRegenerate: () => void
  onMoveToReview: () => void
}) {
  const isLoading = loadingStep !== 'idle'
  const hasContent = bodyText.length > 0

  if (!hasContent && !isLoading) {
    return (
      <div className="flex h-full min-h-48 items-center justify-center rounded-lg border-2 border-dashed border-gray-100 text-sm text-gray-400">
        왼쪽에서 내용 입력 후 글을 생성하세요.
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <ProgressBar step={loadingStep} />
      {hasContent && (
        <>
          <div>
            <div className="mb-1 flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">생성된 본문</p>
              <span className="text-xs text-gray-400">{bodyText.length}자</span>
            </div>
            <textarea
              value={bodyText}
              onChange={(e) => setBodyText(e.target.value)}
              rows={14}
              disabled={isLoading}
              className="w-full rounded-lg border border-gray-200 p-3 font-mono text-sm leading-relaxed text-gray-900 focus:border-blue-400 focus:outline-none disabled:bg-gray-50 disabled:text-gray-700"
            />
          </div>
          {scoreResult && (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <ScoreBadge score={scoreResult.match_score} />
              </div>
              {scoreResult.diagnosis && (
                <p className="rounded-lg bg-gray-50 p-3 text-sm text-gray-700">{scoreResult.diagnosis}</p>
              )}
              {(scoreResult.highlights?.length ?? 0) > 0 && (
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">어색한 표현</p>
                  <HighlightList highlights={scoreResult.highlights} />
                </div>
              )}
            </div>
          )}
          <div className="space-y-2 border-t border-gray-100 pt-4">
            <textarea
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              rows={2}
              placeholder="재생성 피드백 (선택) — 예: 좀 더 가볍게, 마지막에 구매 링크 강조"
              disabled={isLoading}
              className="w-full rounded-lg border border-gray-200 p-2.5 text-sm placeholder:text-gray-400 focus:border-blue-400 focus:outline-none disabled:bg-gray-50"
            />
            <div className="flex gap-2">
              <button type="button" onClick={onRegenerate} disabled={isLoading} className="flex-1 rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                재생성
              </button>
              <button type="button" onClick={onMoveToReview} disabled={isLoading} className="flex-1 rounded-lg bg-green-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50">
                검수로 넘기기 →
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ── 메인 페이지 ───────────────────────────────────────────────────────────────

function GeneratePageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const voiceProfileId = searchParams.get('voice_profile_id')

  const [postType, setPostType] = useState<PostType>('product')
  const [manualItems, setManualItems] = useState<ManualItem[]>([emptyItem()])
  const [dailyContent, setDailyContent] = useState('')
  const [reviewContent, setReviewContent] = useState<ReviewContent>({ place: '', experience: '' })
  const [imageFiles, setImageFiles] = useState<File[]>([])

  const [postId, setPostId] = useState<string | null>(null)
  const [bodyText, setBodyText] = useState('')
  const [scoreResult, setScoreResult] = useState<ScoreApiResult | null>(null)
  const [loadingStep, setLoadingStep] = useState<LoadingStep>('idle')
  const [error, setError] = useState<string | null>(null)
  const [feedback, setFeedback] = useState('')

  const buildContentPayload = useCallback(() => {
    if (postType === 'product') {
      return {
        product_data: {
          source: 'manual' as const,
          items: manualItems.filter((it) => it.name.trim()).map((it) => ({
            name: it.name.trim(),
            price: it.price ? Number(it.price) : undefined,
            url: it.url || undefined,
            image_url: it.image_url || undefined,
          })),
        },
      }
    }
    if (postType === 'daily') return { daily_content: dailyContent }
    if (postType === 'review') return { review_place: reviewContent.place, review_experience: reviewContent.experience }
    return {}
  }, [postType, manualItems, dailyContent, reviewContent])

  async function runScoring(pid: string): Promise<ScoreApiResult | null> {
    setLoadingStep('scoring')
    const res = await fetch(`/api/posts/${pid}/score`, { method: 'POST' })
    if (!res.ok) return null
    return res.json() as Promise<ScoreApiResult>
  }

  async function handleGenerate() {
    if (!voiceProfileId) return
    setError(null)
    setBodyText('')
    setScoreResult(null)

    try {
      setLoadingStep('creating')
      const createRes = await fetch('/api/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voice_profile_id: voiceProfileId, post_type: postType, ...buildContentPayload() }),
      })
      if (!createRes.ok) throw new Error((await createRes.json()).error)
      const { id } = await createRes.json()
      setPostId(id)

      if (imageFiles.length > 0) {
        setLoadingStep('uploading')
        for (const file of imageFiles) {
          const fd = new FormData()
          fd.append('file', file)
          const upRes = await fetch(`/api/posts/${id}/images/upload`, { method: 'POST', body: fd })
          if (!upRes.ok) continue
          const { id: imageId } = await upRes.json()
          await fetch(`/api/posts/${id}/images/interpret`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ image_id: imageId }),
          })
        }
      } else if (postType === 'product') {
        setLoadingStep('sourcing')
        const context = manualItems.map((it) => it.name.trim()).filter(Boolean).join(' ')
        const sourceRes = await fetch(`/api/posts/${id}/images/source`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ needed_count: 3, context }),
        })
        if (!sourceRes.ok) {
          const body = await sourceRes.json().catch(() => ({})) as { error?: string }
          console.warn('[source] 이미지 소싱 실패:', body.error)
        }
      }

      setLoadingStep('generating')
      const genRes = await fetch(`/api/posts/${id}/generate`, { method: 'POST' })
      if (!genRes.ok) throw new Error((await genRes.json()).error)
      const { body_text } = await genRes.json()
      setBodyText(body_text)

      const score = await runScoring(id)
      if (score) setScoreResult(score)
    } catch (err) {
      setError(err instanceof Error ? err.message : '오류가 발생했습니다.')
    } finally {
      setLoadingStep('idle')
    }
  }

  async function handleRegenerate() {
    if (!postId) return
    setError(null)
    try {
      setLoadingStep('regenerating')
      const res = await fetch(`/api/posts/${postId}/regenerate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feedback }),
      })
      if (!res.ok) throw new Error((await res.json()).error)
      const { body_text } = await res.json()
      setBodyText(body_text)
      setFeedback('')
      const score = await runScoring(postId)
      if (score) setScoreResult(score)
    } catch (err) {
      setError(err instanceof Error ? err.message : '오류가 발생했습니다.')
    } finally {
      setLoadingStep('idle')
    }
  }

  if (!voiceProfileId) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center">
        <p className="text-gray-500">
          먼저{' '}
          <a href="/onboarding" className="text-blue-600 underline">말투 분석</a>
          을 완료해주세요.
        </p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">글 생성</h1>
          <p className="mt-1 text-sm text-gray-500">글 유형을 고르고 내용을 입력하면 내 말투로 자동 생성됩니다.</p>
        </div>
        <a href="/dashboard" className="text-sm text-gray-400 hover:text-gray-600">내 글 목록 →</a>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
          <LeftPanel
            postType={postType} setPostType={setPostType}
            manualItems={manualItems} setManualItems={setManualItems}
            dailyContent={dailyContent} setDailyContent={setDailyContent}
            reviewContent={reviewContent} setReviewContent={setReviewContent}
            imageFiles={imageFiles} setImageFiles={setImageFiles}
            onGenerate={handleGenerate} loadingStep={loadingStep}
          />
        </div>
        <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
          <RightPanel
            loadingStep={loadingStep} bodyText={bodyText} setBodyText={setBodyText}
            scoreResult={scoreResult} feedback={feedback} setFeedback={setFeedback}
            onRegenerate={handleRegenerate}
            onMoveToReview={() => postId && router.push(`/review?post_id=${postId}`)}
          />
        </div>
      </div>
    </div>
  )
}

export default function GeneratePage() {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-gray-400">로딩 중…</div>}>
      <GeneratePageInner />
    </Suspense>
  )
}
