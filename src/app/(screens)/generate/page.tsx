'use client'

import { useState, useRef, useCallback, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import type { ProductItem, ScoreApiResult, Highlight } from '@/types'

// ── 타입 ─────────────────────────────────────────────────────────────────────

interface ManualItem {
  name: string
  price: string
  url: string
  image_url: string  // 내부용 — UI에 노출 안 함, 쿠팡 가져오기 시 자동 채워짐
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

// ── 왼쪽 패널: 상품 + 이미지 ─────────────────────────────────────────────────

function LeftPanel({
  manualItems,
  setManualItems,
  isFetchMode,
  setIsFetchMode,
  fetchSource,
  setFetchSource,
  fetchQuery,
  setFetchQuery,
  imageFiles,
  setImageFiles,
  onGenerate,
  loadingStep,
}: {
  manualItems: ManualItem[]
  setManualItems: (v: ManualItem[]) => void
  isFetchMode: boolean
  setIsFetchMode: (v: boolean) => void
  fetchSource: 'coupang' | 'oliveyoung'
  setFetchSource: (v: 'coupang' | 'oliveyoung') => void
  fetchQuery: string
  setFetchQuery: (v: string) => void
  imageFiles: File[]
  setImageFiles: (v: File[]) => void
  onGenerate: () => void
  loadingStep: LoadingStep
}) {
  const [isFetching, setIsFetching] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const isLoading = loadingStep !== 'idle'

  async function handleFetch() {
    setIsFetching(true)
    setFetchError(null)
    try {
      const res = await fetch('/api/products/fetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: fetchSource, query_or_url: fetchQuery }),
      })
      const json = await res.json()
      if (res.status === 503 || json.fallback) {
        setIsFetchMode(false)
        setFetchError('자동 가져오기를 사용할 수 없습니다. 수동으로 입력해주세요.')
        return
      }
      const items: ProductItem[] = json.items ?? []
      setManualItems(
        items.map((it) => ({
          name: it.name,
          price: String(it.price ?? ''),
          url: it.url ?? '',
          image_url: it.image_url ?? '',
        })),
      )
      setIsFetchMode(false)
    } catch {
      setIsFetchMode(false)
      setFetchError('가져오기 중 오류가 발생했습니다. 수동으로 입력해주세요.')
    } finally {
      setIsFetching(false)
    }
  }

  function updateItem(idx: number, field: keyof ManualItem, val: string) {
    const next = manualItems.map((it, i) => (i === idx ? { ...it, [field]: val } : it))
    setManualItems(next)
  }

  function addItem() {
    setManualItems([...manualItems, emptyItem()])
  }

  function removeItem(idx: number) {
    setManualItems(manualItems.filter((_, i) => i !== idx))
  }

  function handleFiles(files: FileList | null) {
    if (!files) return
    setImageFiles([...imageFiles, ...Array.from(files)])
  }

  const canGenerate =
    !isLoading && manualItems.some((it) => it.name.trim())

  return (
    <div className="space-y-5">
      {/* 상품 소스 선택 */}
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">상품 소스</p>
        <div className="flex gap-2">
          {(['coupang', 'oliveyoung'] as const).map((src) => (
            <button
              key={src}
              type="button"
              onClick={() => { setFetchSource(src); setIsFetchMode(true) }}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                fetchSource === src && isFetchMode
                  ? 'border-blue-500 bg-blue-50 text-blue-700'
                  : 'border-gray-200 text-gray-600 hover:border-gray-300'
              }`}
            >
              {src === 'coupang' ? '쿠팡' : '올리브영'}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setIsFetchMode(false)}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              !isFetchMode
                ? 'border-blue-500 bg-blue-50 text-blue-700'
                : 'border-gray-200 text-gray-600 hover:border-gray-300'
            }`}
          >
            수동 입력
          </button>
        </div>
      </div>

      {/* 검색어 + 가져오기 */}
      {isFetchMode && (
        <div className="flex gap-2">
          <input
            type="text"
            value={fetchQuery}
            onChange={(e) => setFetchQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleFetch()}
            placeholder="상품명 또는 URL 입력"
            disabled={isFetching}
            className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none"
          />
          <button
            type="button"
            onClick={handleFetch}
            disabled={isFetching || !fetchQuery.trim()}
            className="rounded-lg bg-gray-800 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:bg-gray-200 disabled:text-gray-500"
          >
            {isFetching ? '가져오는 중…' : '가져오기'}
          </button>
        </div>
      )}

      {fetchError && (
        <p className="rounded-lg bg-yellow-50 px-3 py-2 text-xs text-yellow-700">{fetchError}</p>
      )}

      {/* 수동 입력 폼 — 정상 경로 */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            상품 목록
          </p>
          <button
            type="button"
            onClick={addItem}
            className="text-xs text-blue-600 hover:underline"
          >
            + 상품 추가
          </button>
        </div>

        {manualItems.map((item, idx) => (
          <div key={idx} className="rounded-lg border border-gray-200 p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-medium text-gray-500">상품 {idx + 1}</span>
              {manualItems.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeItem(idx)}
                  className="text-xs text-red-400 hover:text-red-600"
                >
                  삭제
                </button>
              )}
            </div>
            <div className="space-y-2">
              {(
                [
                  { field: 'name', placeholder: '상품명 *', required: true },
                  { field: 'price', placeholder: '가격 (숫자)' },
                  { field: 'url', placeholder: '상품 URL (쿠팡 파트너스 링크)' },
                ] as { field: keyof ManualItem; placeholder: string; required?: boolean }[]
              ).map(({ field, placeholder }) => (
                <div key={field}>
                  <input
                    type="text"
                    value={item[field]}
                    onChange={(e) => updateItem(idx, field, e.target.value)}
                    placeholder={placeholder}
                    disabled={isLoading}
                    className="w-full rounded border border-gray-200 px-2.5 py-1.5 text-xs text-gray-900 placeholder:text-gray-400 focus:border-blue-400 focus:outline-none disabled:bg-gray-50 disabled:text-gray-500"
                  />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* 이미지 첨부 */}
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
          이미지 첨부
        </p>
        <p className="mb-2 text-[11px] leading-snug text-gray-400">
          사진을 직접 올리거나, 위 상품 URL(쿠팡 파트너스)이 있으면 자동으로 이미지가 삽입됩니다.
          이미지 없으면 텍스트만 생성됩니다.
        </p>
        <div
          onClick={() => fileInputRef.current?.click()}
          className="flex cursor-pointer items-center justify-center rounded-lg border-2 border-dashed border-gray-200 px-4 py-6 text-sm text-gray-400 transition-colors hover:border-blue-300 hover:text-blue-500"
        >
          클릭해서 이미지 선택
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
        {imageFiles.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {imageFiles.map((f, i) => (
              <div key={i} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={URL.createObjectURL(f)}
                  alt={f.name}
                  className="h-16 w-16 rounded object-cover"
                />
                <button
                  type="button"
                  onClick={() => setImageFiles(imageFiles.filter((_, j) => j !== i))}
                  className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] text-white"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 이미지 없을 때 안내 */}
      {!isLoading && imageFiles.length === 0 && !manualItems.some((it) => it.url.trim()) && (
        <p className="rounded-lg bg-yellow-50 px-3 py-2 text-[11px] text-yellow-700">
          이미지 없이 생성됩니다. 사진을 첨부하거나 쿠팡 URL을 입력하면 이미지가 삽입됩니다.
        </p>
      )}

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

// ── 오른쪽 패널: 본문 + 점수 ─────────────────────────────────────────────────

function RightPanel({
  loadingStep,
  bodyText,
  setBodyText,
  scoreResult,
  feedback,
  setFeedback,
  onRegenerate,
  onMoveToReview,
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
        왼쪽 패널에서 상품 정보를 입력하고 글을 생성하세요.
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <ProgressBar step={loadingStep} />

      {hasContent && (
        <>
          {/* 본문 편집 */}
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

          {/* 점수 */}
          {scoreResult && (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <ScoreBadge score={scoreResult.match_score} />
              </div>

              {scoreResult.diagnosis && (
                <p className="rounded-lg bg-gray-50 p-3 text-sm text-gray-700">
                  {scoreResult.diagnosis}
                </p>
              )}

              {(scoreResult.highlights?.length ?? 0) > 0 && (
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                    어색한 표현
                  </p>
                  <HighlightList highlights={scoreResult.highlights} />
                </div>
              )}
            </div>
          )}

          {/* 재생성 */}
          <div className="space-y-2 border-t border-gray-100 pt-4">
            <textarea
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              rows={2}
              placeholder="재생성 피드백 (선택 사항) — 예: 좀 더 가볍게, 마지막에 이벤트 정보 추가해줘"
              disabled={isLoading}
              className="w-full rounded-lg border border-gray-200 p-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-400 focus:outline-none disabled:bg-gray-50 disabled:text-gray-500"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onRegenerate}
                disabled={isLoading}
                className="flex-1 rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                재생성
              </button>
              <button
                type="button"
                onClick={onMoveToReview}
                disabled={isLoading}
                className="flex-1 rounded-lg bg-green-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
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

  // 상품 입력 상태
  const [fetchSource, setFetchSource] = useState<'coupang' | 'oliveyoung'>('coupang')
  const [fetchQuery, setFetchQuery] = useState('')
  const [isFetchMode, setIsFetchMode] = useState(false)
  const [manualItems, setManualItems] = useState<ManualItem[]>([emptyItem()])

  // 이미지
  const [imageFiles, setImageFiles] = useState<File[]>([])

  // 생성 상태
  const [postId, setPostId] = useState<string | null>(null)
  const [bodyText, setBodyText] = useState('')
  const [scoreResult, setScoreResult] = useState<ScoreApiResult | null>(null)
  const [loadingStep, setLoadingStep] = useState<LoadingStep>('idle')
  const [error, setError] = useState<string | null>(null)

  // 재생성
  const [feedback, setFeedback] = useState('')

  const toProductData = useCallback(() => ({
    source: 'manual' as const,
    items: manualItems
      .filter((it) => it.name.trim())
      .map((it) => ({
        name: it.name.trim(),
        price: it.price ? Number(it.price) : undefined,
        url: it.url || undefined,
        image_url: it.image_url || undefined,
      })),
  }), [manualItems])

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
      // 1. 포스트 초안 생성
      setLoadingStep('creating')
      const productData = toProductData()
      const createRes = await fetch('/api/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voice_profile_id: voiceProfileId, product_data: productData }),
      })
      if (!createRes.ok) throw new Error((await createRes.json()).error)
      const { id } = await createRes.json()
      setPostId(id)

      // 2. 이미지 처리
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
      } else {
        // 이미지 없으면 공식/스톡 자동 소싱 (실패해도 비블로킹 — 글 생성 계속)
        setLoadingStep('sourcing')
        const context = manualItems
          .map((it) => it.name.trim())
          .filter(Boolean)
          .join(' ')
        const sourceRes = await fetch(`/api/posts/${id}/images/source`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ needed_count: 3, context }),
        })
        if (!sourceRes.ok) {
          // 소싱 실패는 경고만 — 이미지 없이 생성으로 계속
          const body = await sourceRes.json().catch(() => ({})) as { error?: string }
          console.warn('[source] 이미지 소싱 실패:', body.error)
        }
      }

      // 3. 본문 생성
      setLoadingStep('generating')
      const genRes = await fetch(`/api/posts/${id}/generate`, { method: 'POST' })
      if (!genRes.ok) throw new Error((await genRes.json()).error)
      const { body_text } = await genRes.json()
      setBodyText(body_text)

      // 4. 채점
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
      const regenRes = await fetch(`/api/posts/${postId}/regenerate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feedback }),
      })
      if (!regenRes.ok) throw new Error((await regenRes.json()).error)
      const { body_text } = await regenRes.json()
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

  function handleMoveToReview() {
    if (!postId) return
    router.push(`/review?post_id=${postId}`)
  }

  if (!voiceProfileId) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center">
        <p className="text-gray-500">
          먼저{' '}
          <a href="/onboarding" className="text-blue-600 underline">
            말투 분석
          </a>
          을 완료해주세요.
        </p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">글 생성</h1>
        <p className="mt-1 text-sm text-gray-500">
          상품 정보를 입력하면 분석된 말투로 블로그 글을 자동 생성합니다.
        </p>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* 왼쪽: 상품 + 이미지 */}
        <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
          <LeftPanel
            manualItems={manualItems}
            setManualItems={setManualItems}
            isFetchMode={isFetchMode}
            setIsFetchMode={setIsFetchMode}
            fetchSource={fetchSource}
            setFetchSource={setFetchSource}
            fetchQuery={fetchQuery}
            setFetchQuery={setFetchQuery}
            imageFiles={imageFiles}
            setImageFiles={setImageFiles}
            onGenerate={handleGenerate}
            loadingStep={loadingStep}
          />
        </div>

        {/* 오른쪽: 생성 결과 */}
        <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
          <RightPanel
            loadingStep={loadingStep}
            bodyText={bodyText}
            setBodyText={setBodyText}
            scoreResult={scoreResult}
            feedback={feedback}
            setFeedback={setFeedback}
            onRegenerate={handleRegenerate}
            onMoveToReview={handleMoveToReview}
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
