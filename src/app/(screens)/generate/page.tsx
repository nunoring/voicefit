'use client'

import { useState, useRef, useCallback, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import type { PostType, ProductItem, ScoreApiResult, Highlight, UsageBasis } from '@/types'
import { COMMERCE_SECTION_HEADERS, splitCommerceSections, type CommerceSectionHeader } from '@/lib/commerce-pack'
import {
  chooseVoiceProfileId,
  readSelectedVoiceProfileId,
  writeSelectedVoiceProfileId,
  type VoiceProfileListItem,
} from '@/lib/voice-profile-selection'

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

type LoadingStep = 'idle' | 'creating' | 'uploading' | 'sourcing' | 'generating' | 'scoring' | 'polishing' | 'regenerating' | 'saving'

const VOICE_SCORE_PASS = 75
const VOICE_SCORE_TARGET = 85
const AUTO_POLISH_POST_TYPES = new Set<PostType>(['daily', 'review', 'product'])

const STEP_LABELS: Record<LoadingStep, string> = {
  idle: '',
  creating: '포스트 초안 생성 중…',
  uploading: '이미지 업로드 및 해석 중…',
  sourcing: '이미지 소싱 중…',
  generating: '본문 생성 중…',
  scoring: '말투 일치도 채점 중…',
  polishing: '말투 자동 보정 중…',
  regenerating: '재생성 중…',
  saving: '수정본 저장 중…',
}

const POST_TYPES: { type: PostType; icon: string; label: string; desc: string }[] = [
  { type: 'product',       icon: '🛍️', label: '상품 리뷰',   desc: '쿠팡, 오늘의집, 올리브영 등' },
  { type: 'daily',         icon: '☀️', label: '일상 기록',   desc: '오늘 있었던 일, 생각' },
  { type: 'review',        icon: '⭐', label: '경험 리뷰',   desc: '카페, 맛집, 장소 후기' },
  { type: 'coupang',       icon: '📦', label: '쿠팡 상품평', desc: '체험단·구매평 (앱에 붙여넣기)' },
  { type: 'commerce_pack', icon: '🧪', label: '커머스 패키지', desc: '블로그+쇼츠+캡션+CTA 한 번에' },
]

function normalizePostType(value: string | null): PostType {
  const found = POST_TYPES.find((item) => item.type === value)
  return found?.type ?? 'product'
}

function emptyItem(): ManualItem {
  return { name: '', price: '', url: '', image_url: '' }
}

const USAGE_BASIS_OPTIONS: { value: UsageBasis; label: string }[] = [
  { value: 'used',      label: '직접 사용함' },
  { value: 'not_used',  label: '사용 안 함' },
  { value: 'curation',  label: '정보성 큐레이션' },
]

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

function buildAutoPolishFeedback(score: ScoreApiResult): string {
  const highlights = (score.highlights ?? [])
    .map((h) => `- ${h.issue_type}: "${h.text}" → ${h.suggestion}`)
    .join('\n')

  return [
    `현재 말투 점수는 ${score.match_score}점입니다. 목표는 ${VOICE_SCORE_TARGET}점 이상입니다.`,
    '사실은 유지하고 말투만 다시 입히세요.',
    '문단 길이를 더 들쭉날쭉하게 만들고, 원문처럼 줄넘김·붙여쓰기·이모티콘·ㅋㅋ/ㅎㅎ·!!/?? 타이밍을 살리세요.',
    '정형 소제목, 구분선, 요약형 마무리, 너무 깔끔한 정보문 톤은 제거하세요.',
    score.diagnosis ? `진단: ${score.diagnosis}` : '',
    highlights ? `수정 포인트:\n${highlights}` : '',
  ].filter(Boolean).join('\n\n')
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
              <p className="font-medium text-gray-800">&quot;{h.text}&quot;</p>
              <p className="mt-0.5 text-gray-600">→ {h.suggestion}</p>
            </div>
          </div>
        </li>
      ))}
    </ul>
  )
}

function SectionCopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1200)
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="rounded-md border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50"
    >
      {copied ? '복사됨' : '복사'}
    </button>
  )
}

const COMMERCE_SECTION_META: Record<CommerceSectionHeader, { label: string; hint: string }> = {
  '블로그 글': { label: '블로그', hint: '네이버/티스토리 본문에 넣을 긴 글' },
  '쇼츠 대본': { label: '쇼츠 대본', hint: '영상 촬영 또는 TTS용 스크립트' },
  '쇼츠 제작 지시서': { label: '쇼츠 제작', hint: '9:16 영상 편집/TTS/B-roll 작업 지시서' },
  '쇼츠 설명란': { label: '쇼츠 설명란', hint: '유튜브 쇼츠 설명란에 붙여넣기' },
  '릴스 캡션': { label: '릴스 캡션', hint: '인스타 릴스 본문/해시태그' },
  '고정댓글 / CTA': { label: '댓글/CTA', hint: '고정댓글과 행동 유도 문구' },
  '제휴 고지': { label: '제휴 고지', hint: '채널별 고지 문구' },
  '실험 가설': { label: '실험 가설', hint: '클릭/저장/전환 실험 기준' },
  '발행 전 체크리스트': { label: '체크리스트', hint: '발행 직전 검수 항목' },
}

function CommercePackResult({ bodyText }: { bodyText: string }) {
  const sections = splitCommerceSections(bodyText)
  const availableSections = COMMERCE_SECTION_HEADERS
    .map((header) => ({ header, text: sections[header] ?? '' }))
    .filter(({ text }) => text.trim().length > 0)
  const [active, setActive] = useState<CommerceSectionHeader>(
    availableSections[0]?.header ?? COMMERCE_SECTION_HEADERS[0],
  )
  const activeText = sections[active] ?? ''

  if (!availableSections.length) return null

  return (
    <div className="rounded-lg border border-blue-100 bg-blue-50/40 p-3">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-blue-900">커머스 패키지 결과</p>
          <p className="text-xs text-blue-700">블로그에 전부 붙이는 글이 아니라, 채널별로 따로 쓰는 묶음입니다.</p>
        </div>
        <span className="shrink-0 rounded-full bg-white px-2 py-1 text-xs font-medium text-blue-700">
          {availableSections.length}/{COMMERCE_SECTION_HEADERS.length}
        </span>
      </div>

      <div className="mb-3 flex flex-wrap gap-1.5">
        {availableSections.map(({ header }) => {
          const meta = COMMERCE_SECTION_META[header]
          return (
            <button
              key={header}
              type="button"
              onClick={() => setActive(header)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium ${
                active === header
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-gray-600 hover:bg-blue-100'
              }`}
            >
              {meta.label}
            </button>
          )
        })}
      </div>

      <div className="rounded-lg border border-blue-100 bg-white p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div>
            <p className="text-sm font-semibold text-gray-900">{COMMERCE_SECTION_META[active].label}</p>
            <p className="text-xs text-gray-500">{COMMERCE_SECTION_META[active].hint}</p>
          </div>
          <SectionCopyButton text={activeText} />
        </div>
        <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-md bg-gray-50 p-3 text-sm leading-relaxed text-gray-800">
          {activeText}
        </pre>
      </div>
    </div>
  )
}

// ── 왼쪽 패널 ────────────────────────────────────────────────────────────────

function LeftPanel({
  postType, setPostType,
  manualItems, setManualItems,
  dailyContent, setDailyContent,
  reviewContent, setReviewContent,
  imageFiles, setImageFiles,
  usageBasis, setUsageBasis,
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
  usageBasis: UsageBasis
  setUsageBasis: (v: UsageBasis) => void
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
      const items: ProductItem[] = json.items ?? []
      if (!items.length && (res.status === 503 || json.fallback || !res.ok)) {
        setFetchError('자동 가져오기 실패. 아래에 직접 입력해주세요.')
        return
      }
      setManualItems(items.map((it) => ({
        name: it.name,
        price: String(it.price ?? ''),
        url: it.url ?? url,
        image_url: it.image_url ?? '',
      })))
      if (json.fallback) {
        setFetchError('상품 URL은 넣었어요. 상품명/가격은 직접 확인해서 보완해주세요.')
      }
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

  // 클립보드 붙여넣기(Ctrl+V)로 이미지 첨부 — 다운로드 없이 바로.
  // 클립보드에 이미지가 있을 때만 동작하므로 텍스트 붙여넣기엔 영향 없음.
  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      const items = e.clipboardData?.items
      if (!items) return
      const pasted: File[] = []
      for (const item of Array.from(items)) {
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          const blob = item.getAsFile()
          if (blob) {
            const ext = (item.type.split('/')[1] || 'png').replace('jpeg', 'jpg')
            pasted.push(new File([blob], `pasted-${Date.now()}-${pasted.length}.${ext}`, { type: item.type }))
          }
        }
      }
      if (!pasted.length) return
      e.preventDefault()
      setImageFiles([...imageFiles, ...pasted])
      setImageSourcingStatus('idle')
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [imageFiles, setImageFiles])

  const canGenerate = !isLoading && (() => {
    if (postType === 'product' || postType === 'commerce_pack') return manualItems.some((it) => it.name.trim())
    if (postType === 'daily') return dailyContent.trim().length >= 10
    if (postType === 'review') return reviewContent.place.trim().length >= 2
    if (postType === 'coupang') return reviewContent.place.trim().length >= 2
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
      {(postType === 'product' || postType === 'commerce_pack') && (
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

          {(postType === 'commerce_pack' || postType === 'product') && (
            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">이 상품, 직접 써봤나요?</p>
              <div className="flex gap-2">
                {USAGE_BASIS_OPTIONS.map(({ value, label }) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setUsageBasis(value)}
                    disabled={isLoading}
                    className={`flex-1 rounded-lg border py-2 text-xs font-medium transition-colors ${
                      usageBasis === value
                        ? 'border-blue-500 bg-blue-50 text-blue-700'
                        : 'border-gray-200 text-gray-600 hover:border-gray-300'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-[11px] text-gray-400">
                {usageBasis === 'used'
                  ? '"직접 써보니" 같은 1인칭 후기 표현이 허용됩니다.'
                  : '직접 사용 후기 표현("써보니" 등)은 자동으로 막고, 정보 제공자 톤으로 작성됩니다.'}
              </p>
            </div>
          )}
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

      {(postType === 'review' || postType === 'coupang') && (
        <div className="space-y-3">
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500">
              {postType === 'coupang' ? '상품명' : '장소 / 서비스 이름'}
            </label>
            <input
              type="text"
              value={reviewContent.place}
              onChange={(e) => setReviewContent({ ...reviewContent, place: e.target.value })}
              disabled={isLoading}
              placeholder={postType === 'coupang' ? '예: 무선 이어폰 ○○, 스탠드 조명 △△' : '예: 성수동 카페 어니언, 강남 스시 오마카세'}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm placeholder:text-gray-400 focus:border-blue-500 focus:outline-none disabled:bg-gray-50"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500">
              {postType === 'coupang' ? '사용 경험 메모' : '경험 메모'}
            </label>
            <textarea
              value={reviewContent.experience}
              onChange={(e) => setReviewContent({ ...reviewContent, experience: e.target.value })}
              disabled={isLoading}
              rows={5}
              placeholder={postType === 'coupang' ? '써보니 어땠는지 자유롭게. 체험단이면 "쿠팡 체험단으로 제공받음"도 적어주세요.' : '느낀 점, 특이한 점, 추천 메뉴 등 자유롭게'}
              className="w-full rounded-lg border border-gray-300 p-3 text-sm placeholder:text-gray-400 focus:border-blue-500 focus:outline-none disabled:bg-gray-50"
            />
          </div>
        </div>
      )}

      {/* 이미지 첨부 */}
      <div>
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">이미지 첨부</p>
        <p className="mb-2 text-[11px] text-gray-400">
          {postType === 'product' || postType === 'commerce_pack'
            ? '첨부하지 않으면 쿠팡 공식 이미지를 사용합니다.'
            : postType === 'coupang'
            ? '사진 최대 10장 — 많을수록 쿠팡 상품평 점수에 유리해요.'
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
          {isDragging ? '여기에 놓으세요' : '클릭 · 드래그 · 붙여넣기(Ctrl+V)로 이미지 첨부'}
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
  postType,
  loadingStep, bodyText, setBodyText, scoreResult,
  feedback, setFeedback, onRegenerate, onMoveToReview,
}: {
  postType: PostType
  loadingStep: LoadingStep
  bodyText: string
  setBodyText: (v: string) => void
  scoreResult: ScoreApiResult | null
  feedback: string
  setFeedback: (v: string) => void
  onRegenerate: () => void
  onMoveToReview: () => void | Promise<void>
}) {
  const isLoading = loadingStep !== 'idle'
  const hasContent = bodyText.length > 0
  const scoreBlocked = !!scoreResult && scoreResult.match_score < VOICE_SCORE_PASS
  const scoreNeedsPolish = !!scoreResult && scoreResult.match_score >= VOICE_SCORE_PASS && scoreResult.match_score < VOICE_SCORE_TARGET

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
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                {postType === 'commerce_pack' ? '원본 markdown' : '생성된 본문'}
              </p>
              <span className="text-xs text-gray-400">{bodyText.length}자</span>
            </div>
            {postType === 'commerce_pack' && (
              <div className="mb-3">
                <CommercePackResult bodyText={bodyText} />
              </div>
            )}
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
              {scoreBlocked && (
                <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  말투 점수가 {VOICE_SCORE_PASS}점 미만입니다. AI티가 날 가능성이 있어 재생성 후 검수로 넘기세요.
                </p>
              )}
              {scoreNeedsPolish && (
                <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                  발행 후보는 맞지만 목표 점수 {VOICE_SCORE_TARGET}점에는 못 미칩니다. 한 번 더 재생성하거나 직접 문단 리듬을 다듬는 것을 권장합니다.
                </p>
              )}
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
              <button type="button" onClick={onMoveToReview} disabled={isLoading || scoreBlocked} className="flex-1 rounded-lg bg-green-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400">
                {scoreBlocked ? '말투 재생성 필요' : '저장 후 검수 →'}
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
  const searchParamString = searchParams.toString()
  const requestedVoiceProfileId = searchParams.get('voice_profile_id')
  const requestedPostType = normalizePostType(searchParams.get('type'))

  const [postType, setPostType] = useState<PostType>(requestedPostType)
  const [profiles, setProfiles] = useState<VoiceProfileListItem[]>([])
  const [profilesLoading, setProfilesLoading] = useState(true)
  const [manualVoiceProfileId, setManualVoiceProfileId] = useState<string | null>(() => (
    requestedVoiceProfileId ?? readSelectedVoiceProfileId()
  ))
  const [manualItems, setManualItems] = useState<ManualItem[]>([emptyItem()])
  const [dailyContent, setDailyContent] = useState('')
  const [reviewContent, setReviewContent] = useState<ReviewContent>({ place: '', experience: '' })
  const [imageFiles, setImageFiles] = useState<File[]>([])
  const [usageBasis, setUsageBasis] = useState<UsageBasis>('curation')

  const [postId, setPostId] = useState<string | null>(null)
  const [bodyText, setBodyText] = useState('')
  const [scoreResult, setScoreResult] = useState<ScoreApiResult | null>(null)
  const [loadingStep, setLoadingStep] = useState<LoadingStep>('idle')
  const [error, setError] = useState<string | null>(null)
  const [feedback, setFeedback] = useState('')

  useEffect(() => {
    let cancelled = false
    fetch('/api/voice-profiles')
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return
        setProfiles(Array.isArray(data) ? data as VoiceProfileListItem[] : [])
        setProfilesLoading(false)
      })
      .catch(() => {
        if (!cancelled) setProfilesLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const voiceProfileId = chooseVoiceProfileId(
    profiles,
    requestedVoiceProfileId ?? manualVoiceProfileId,
  )

  useEffect(() => {
    if (profilesLoading) return
    writeSelectedVoiceProfileId(voiceProfileId)

    if (voiceProfileId && voiceProfileId !== requestedVoiceProfileId) {
      const params = new URLSearchParams(searchParamString)
      params.set('voice_profile_id', voiceProfileId)
      router.replace(`/generate?${params.toString()}`, { scroll: false })
    }
  }, [profilesLoading, requestedVoiceProfileId, router, searchParamString, voiceProfileId])

  function handleSelectVoiceProfile(id: string) {
    setManualVoiceProfileId(id)
    writeSelectedVoiceProfileId(id)
    const params = new URLSearchParams(searchParamString)
    params.set('voice_profile_id', id)
    router.replace(`/generate?${params.toString()}`, { scroll: false })
  }

  const buildContentPayload = useCallback(() => {
    if (postType === 'product' || postType === 'commerce_pack') {
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
        // product도 사용 여부를 함께 저장 — 생성 프롬프트·정책 감사가 체험담 표현 허용 여부를 가른다
        usage_basis: usageBasis,
      }
    }
    if (postType === 'daily') return { daily_content: dailyContent }
    if (postType === 'review') return { review_place: reviewContent.place, review_experience: reviewContent.experience }
    if (postType === 'coupang') return { coupang_product: reviewContent.place, coupang_experience: reviewContent.experience }
    return {}
  }, [postType, manualItems, dailyContent, reviewContent, usageBasis])

  async function runScoring(pid: string): Promise<ScoreApiResult | null> {
    setLoadingStep('scoring')
    const res = await fetch(`/api/posts/${pid}/score`, { method: 'POST' })
    if (!res.ok) return null
    return res.json() as Promise<ScoreApiResult>
  }

  async function regeneratePost(pid: string, feedbackText: string): Promise<string> {
    const res = await fetch(`/api/posts/${pid}/regenerate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ feedback: feedbackText }),
    })
    if (!res.ok) throw new Error((await res.json()).error)
    const { body_text } = await res.json()
    return body_text
  }

  async function autoPolishIfNeeded(pid: string, score: ScoreApiResult | null): Promise<ScoreApiResult | null> {
    if (!score) return null
    if (!AUTO_POLISH_POST_TYPES.has(postType)) return score
    if (score.match_score >= VOICE_SCORE_TARGET) return score

    setLoadingStep('polishing')
    const polishedText = await regeneratePost(pid, buildAutoPolishFeedback(score))
    setBodyText(polishedText)

    const polishedScore = await runScoring(pid)
    return polishedScore ?? score
  }

  async function handleGenerate() {
    if (!voiceProfileId) {
      setError('사용할 말투를 먼저 선택해주세요.')
      return
    }
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
      } else if (postType === 'product' || postType === 'commerce_pack') {
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
      const finalScore = await autoPolishIfNeeded(id, score)
      if (finalScore) setScoreResult(finalScore)
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
      const body_text = await regeneratePost(postId, feedback)
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

  async function handleMoveToReview() {
    if (!postId) return
    setError(null)
    try {
      setLoadingStep('saving')
      const res = await fetch(`/api/posts/${postId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body_text: bodyText }),
      })
      if (!res.ok) throw new Error((await res.json()).error)
      router.push(`/review?post_id=${postId}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : '수정본 저장 중 오류가 발생했습니다.')
    } finally {
      setLoadingStep('idle')
    }
  }

  if (profilesLoading && !voiceProfileId) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center">
        <p className="text-sm text-gray-500">저장된 말투를 불러오는 중입니다.</p>
      </div>
    )
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

  const selectedProfile = profiles.find((profile) => profile.id === voiceProfileId) ?? null

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">글 생성</h1>
          <p className="mt-1 text-sm text-gray-500">글 유형을 고르고 내용을 입력하면 내 말투로 자동 생성됩니다.</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          {profiles.length > 0 && (
            <div className="min-w-64">
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">
                사용할 말투
              </label>
              <select
                value={voiceProfileId}
                onChange={(event) => handleSelectVoiceProfile(event.target.value)}
                disabled={loadingStep !== 'idle'}
                className="min-h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-800 focus:border-blue-400 focus:outline-none disabled:bg-gray-50"
              >
                {profiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.name} · {new Date(profile.created_at).toLocaleDateString('ko-KR')}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[11px] text-gray-400">
                현재 선택: {selectedProfile?.name ?? '저장된 말투'}
              </p>
            </div>
          )}
          <a href="/dashboard" className="pb-2 text-sm text-gray-400 hover:text-gray-600">내 글 목록 →</a>
        </div>
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
            usageBasis={usageBasis} setUsageBasis={setUsageBasis}
            onGenerate={handleGenerate} loadingStep={loadingStep}
          />
        </div>
        <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
          <RightPanel
            postType={postType}
            loadingStep={loadingStep} bodyText={bodyText} setBodyText={setBodyText}
            scoreResult={scoreResult} feedback={feedback} setFeedback={setFeedback}
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
