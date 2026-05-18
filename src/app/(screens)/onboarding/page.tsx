'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import type { ProfileJson, VoiceProfileCreateResponse } from '@/types'

function toDisplay(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value === null || value === undefined) return ''
  if (Array.isArray(value)) return value.map(toDisplay).join(', ')
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => `${k}: ${toDisplay(v)}`)
      .join(', ')
  }
  return JSON.stringify(value)
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map(toDisplay)
}

// ── 하위 컴포넌트 ────────────────────────────────────────────────────────────

function Badge({ children, color = 'blue' }: { children: React.ReactNode; color?: 'blue' | 'purple' | 'gray' }) {
  const cls = { blue: 'bg-blue-100 text-blue-800', purple: 'bg-purple-100 text-purple-800', gray: 'bg-gray-100 text-gray-700' }[color]
  return <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}>{children}</span>
}

function TagList({ items, color }: { items: string[]; color: 'blue' | 'purple' | 'gray' }) {
  if (!items?.length) return <span className="text-xs text-gray-400">없음</span>
  return <div className="flex flex-wrap gap-1.5">{items.map((item) => <Badge key={item} color={color}>{item}</Badge>)}</div>
}

function CheckList({ items, type }: { items: string[]; type: 'do' | 'dont' }) {
  if (!items?.length) return null
  const isDo = type === 'do'
  return (
    <ul className="space-y-1">
      {items.map((item) => (
        <li key={item} className="flex items-start gap-2 text-sm">
          <span className={`mt-0.5 shrink-0 text-base leading-none ${isDo ? 'text-green-500' : 'text-red-400'}`}>{isDo ? '✓' : '✕'}</span>
          <span className="text-gray-700">{item}</span>
        </li>
      ))}
    </ul>
  )
}

function ProfileResult({ profile, reusablePrompt, onConfirm }: {
  profile: ProfileJson | null | undefined
  reusablePrompt: string
  onConfirm: () => void
}) {
  const [showPrompt, setShowPrompt] = useState(false)
  if (!profile) return <p className="text-sm text-gray-400">분석 결과를 불러올 수 없습니다.</p>

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2">
        {toDisplay(profile.tone)      && <Badge color="blue">말투: {toDisplay(profile.tone)}</Badge>}
        {toDisplay(profile.formality) && <Badge color="blue">어체: {toDisplay(profile.formality)}</Badge>}
        {toDisplay(profile.emoji_usage) && <Badge color="blue">이모지: {toDisplay(profile.emoji_usage)}</Badge>}
        {toDisplay(profile.avg_sentence_length) && <Badge color="gray">평균 문장 길이 {toDisplay(profile.avg_sentence_length)}어절</Badge>}
      </div>
      {toDisplay(profile.vocabulary_notes) && (
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">어휘 특징</p>
          <p className="text-sm text-gray-700">{toDisplay(profile.vocabulary_notes)}</p>
        </div>
      )}
      <div>
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">문장 종결 표현</p>
        <TagList items={toStringArray(profile.sentence_endings)} color="purple" />
      </div>
      <div>
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">시그니처 표현</p>
        <TagList items={toStringArray(profile.signature_phrases)} color="gray" />
      </div>
      <div className="grid grid-cols-2 gap-4 rounded-lg border border-gray-100 p-4">
        <div>
          <p className="mb-2 text-xs font-semibold text-green-700">이렇게 써야</p>
          <CheckList items={toStringArray(profile.do_list)} type="do" />
        </div>
        <div>
          <p className="mb-2 text-xs font-semibold text-red-600">이건 피해야</p>
          <CheckList items={toStringArray(profile.dont_list)} type="dont" />
        </div>
      </div>
      <div>
        <button type="button" onClick={() => setShowPrompt((v) => !v)} className="text-xs text-blue-600 hover:underline">
          {showPrompt ? '▲ system 프롬프트 숨기기' : '▼ 생성된 system 프롬프트 보기'}
        </button>
        {showPrompt && <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-gray-50 p-3 text-xs text-gray-600">{reusablePrompt}</pre>}
      </div>
      <button type="button" onClick={onConfirm} className="w-full rounded-lg bg-blue-600 px-4 py-3 text-sm font-semibold text-white hover:bg-blue-700">
        이 말투로 글 생성하기 →
      </button>
    </div>
  )
}

// ── 저장된 말투 카드 ──────────────────────────────────────────────────────────

interface SavedProfile {
  id: string
  name: string
  created_at: string
  profile_json: ProfileJson
}

function SavedProfiles({ onSelect }: { onSelect: (id: string) => void }) {
  const [profiles, setProfiles] = useState<SavedProfile[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/voice-profiles')
      .then((r) => r.json())
      .then((data) => { setProfiles(Array.isArray(data) ? data : []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  if (loading) return null
  if (!profiles.length) return null

  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">저장된 말투</p>
      <div className="space-y-2">
        {profiles.map((p) => (
          <div key={p.id} className="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-3 py-2.5">
            <div>
              <p className="text-sm font-medium text-gray-800">{p.name}</p>
              <p className="text-xs text-gray-400">
                {toDisplay(p.profile_json?.tone)} · {toDisplay(p.profile_json?.formality)} ·{' '}
                {new Date(p.created_at).toLocaleDateString('ko-KR')}
              </p>
            </div>
            <button
              type="button"
              onClick={() => onSelect(p.id)}
              className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
            >
              이 말투 사용
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── 메인 페이지 ───────────────────────────────────────────────────────────────

type Status = 'idle' | 'loading' | 'done' | 'error'
type CrawlStatus = 'idle' | 'loading' | 'success' | 'fallback'

export default function OnboardingPage() {
  const router = useRouter()
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const [sourceText, setSourceText] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<VoiceProfileCreateResponse | null>(null)

  const [crawlUrl, setCrawlUrl] = useState('')
  const [crawlStatus, setCrawlStatus] = useState<CrawlStatus>('idle')
  const [loadedUrls, setLoadedUrls] = useState<string[]>([])
  const [totalImages, setTotalImages] = useState(0)

  const isAnalyzing = status === 'loading'

  function handleSelectSaved(id: string) {
    router.push(`/generate?voice_profile_id=${id}`)
  }

  async function handleCrawl() {
    const trimmedUrl = crawlUrl.trim()
    if (!trimmedUrl) return
    setCrawlStatus('loading')

    try {
      const res = await fetch('/api/crawl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: trimmedUrl }),
      })
      const json = await res.json() as { text?: string; images?: string[]; fallback?: boolean }

      if (!res.ok || json.fallback) {
        setCrawlStatus('fallback')
        textareaRef.current?.focus()
        return
      }

      const fetchedText = json.text ?? ''
      const imgCount = json.images?.length ?? 0

      setSourceText((prev) => {
        const separator = prev.trim() ? '\n\n---\n\n' : ''
        return prev + separator + fetchedText
      })
      setTotalImages((prev) => prev + imgCount)
      setLoadedUrls((prev) => [...prev, trimmedUrl])
      setCrawlStatus('success')
      setCrawlUrl('')
    } catch {
      setCrawlStatus('fallback')
      textareaRef.current?.focus()
    }
  }

  async function handleAnalyze() {
    setError(null)
    setResult(null)
    setStatus('loading')

    try {
      // 이미지 패턴 정보를 텍스트에 포함 → LLM이 이미지 사용 빈도 파악
      const imageNote = totalImages > 0
        ? `\n\n--- 이미지 분석 ---\n위 글(${loadedUrls.length}개)에서 발견된 이미지: 총 ${totalImages}개 (글당 평균 ${Math.round(totalImages / Math.max(loadedUrls.length, 1))}개)`
        : ''
      const fullText = sourceText + imageNote

      const autoName = `말투_${new Date().toLocaleDateString('ko-KR').replace(/\. /g, '-').replace('.', '')}`
      const res = await fetch('/api/voice-profiles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: autoName, source_text: fullText }),
      })

      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)

      setResult(json as VoiceProfileCreateResponse)
      setStatus('done')
    } catch (err) {
      setError(err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.')
      setStatus('error')
    }
  }

  function handleConfirm() {
    if (!result) return
    router.push(`/generate?voice_profile_id=${result.id}`)
  }

  const canSubmit = sourceText.trim().length >= 50

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="mb-1 text-2xl font-bold text-gray-900">내 말투 분석</h1>
      <p className="mb-8 text-sm text-gray-500">블로그 URL을 붙여넣거나 글을 직접 복붙하면 AI가 말투를 분석해 드립니다.</p>

      <div className="space-y-5">
        {/* 저장된 말투 */}
        <SavedProfiles onSelect={handleSelectSaved} />

        {/* URL 크롤링 */}
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
            블로그 URL로 가져오기 <span className="font-normal normal-case text-gray-400">(여러 글 순서대로 추가 가능)</span>
          </p>
          <div className="flex gap-2">
            <input
              type="url"
              value={crawlUrl}
              onChange={(e) => { setCrawlUrl(e.target.value); setCrawlStatus('idle') }}
              onKeyDown={(e) => e.key === 'Enter' && handleCrawl()}
              disabled={crawlStatus === 'loading' || isAnalyzing}
              placeholder="https://blog.naver.com/... 또는 tistory, blogger URL"
              className="flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none disabled:bg-gray-100 disabled:text-gray-400"
            />
            <button
              type="button"
              onClick={handleCrawl}
              disabled={!crawlUrl.trim() || crawlStatus === 'loading' || isAnalyzing}
              className="rounded-lg bg-gray-700 px-4 py-2 text-sm font-medium text-white hover:bg-gray-600 disabled:bg-gray-200 disabled:text-gray-500"
            >
              {crawlStatus === 'loading' ? '가져오는 중…' : '추가'}
            </button>
          </div>

          {crawlStatus === 'loading' && (
            <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-gray-200">
              <div className="h-full animate-[indeterminate_1.5s_ease-in-out_infinite] rounded-full bg-blue-500" />
            </div>
          )}

          {/* 로드된 URL 칩 */}
          {loadedUrls.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {loadedUrls.map((u, i) => (
                <span key={i} className="flex items-center gap-1 rounded-full bg-green-100 px-2.5 py-0.5 text-xs text-green-800">
                  <span>✓</span>
                  <span className="max-w-[180px] truncate">{new URL(u).hostname}</span>
                  <span className="text-green-600">#{i + 1}</span>
                </span>
              ))}
              {totalImages > 0 && (
                <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs text-gray-600">
                  이미지 {totalImages}개 감지
                </span>
              )}
            </div>
          )}

          {crawlStatus === 'fallback' && (
            <p className="mt-2 text-xs text-yellow-700">! 자동 가져오기에 실패했어요. 아래에 직접 붙여넣어 주세요.</p>
          )}
        </div>

        {/* 원문 텍스트 */}
        <div>
          <label className="mb-1.5 block text-sm font-medium text-gray-700">
            블로그 글 (URL로 가져오거나 직접 붙여넣으세요)
          </label>
          <textarea
            ref={textareaRef}
            value={sourceText}
            onChange={(e) => setSourceText(e.target.value)}
            disabled={isAnalyzing}
            rows={12}
            placeholder="블로그 글을 여기에 붙여넣으세요. 많을수록 분석 품질이 올라갑니다."
            className="w-full rounded-lg border border-gray-300 p-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-400"
          />
          <p className="mt-1 text-right text-xs text-gray-400">{sourceText.length}자</p>
        </div>

        {isAnalyzing && (
          <div>
            <div className="mb-1.5 flex items-center justify-between text-xs text-gray-500">
              <span>말투 분석 중…</span>
              <span className="animate-pulse">잠시만 기다려주세요</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
              <div className="h-full animate-[indeterminate_1.5s_ease-in-out_infinite] rounded-full bg-blue-500" />
            </div>
          </div>
        )}

        {status === 'error' && error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
        )}

        {status !== 'done' && (
          <button
            type="button"
            onClick={handleAnalyze}
            disabled={!canSubmit || isAnalyzing}
            className="w-full rounded-lg bg-blue-600 px-4 py-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-500"
          >
            {isAnalyzing ? '분석 중…' : '말투 분석'}
          </button>
        )}

        {status === 'done' && result && (
          <>
            <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-2">
              <span className="inline-flex items-center gap-1 text-sm font-medium text-green-700">
                <span>✓</span> 말투 분석 완료 — 자동 저장됨
              </span>
            </div>
            <ProfileResult profile={result.profile_json} reusablePrompt={result.reusable_system_prompt} onConfirm={handleConfirm} />
            <button type="button" onClick={() => setStatus('idle')} className="w-full rounded-lg border border-gray-200 px-4 py-2.5 text-sm text-gray-600 hover:bg-gray-50">
              다시 입력
            </button>
          </>
        )}
      </div>
    </div>
  )
}
