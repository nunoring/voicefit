'use client'

import { Suspense, useState } from 'react'
import { useSearchParams } from 'next/navigation'

function AccessForm() {
  const searchParams = useSearchParams()
  const next = searchParams.get('next') || '/dashboard'
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      })
      const json = await res.json().catch(() => ({})) as { error?: string }
      if (!res.ok) throw new Error(json.error ?? '접근 확인에 실패했습니다.')
      window.location.href = next
    } catch (err) {
      setError(err instanceof Error ? err.message : '접근 확인에 실패했습니다.')
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#f7f8f5] px-4 py-16">
      <main className="mx-auto max-w-md rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">VoiceFit closed test</p>
        <h1 className="mt-2 text-2xl font-bold text-gray-950">테스트 암호를 입력하세요</h1>
        <p className="mt-2 text-sm leading-6 text-gray-600">
          현재 VoiceFit은 5명 폐쇄 테스트용으로만 열려 있습니다. 받은 암호를 입력하면 작업대로 이동합니다.
        </p>

        <form onSubmit={submit} className="mt-5 space-y-3">
          <input
            type="password"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="테스트 암호"
            autoFocus
            className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-gray-900"
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={loading || !code.trim()}
            className="w-full rounded-lg bg-gray-950 px-4 py-2.5 text-sm font-semibold text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:bg-gray-300"
          >
            {loading ? '확인 중...' : '작업대 들어가기'}
          </button>
        </form>
      </main>
    </div>
  )
}

export default function AccessPage() {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-gray-400">로딩 중...</div>}>
      <AccessForm />
    </Suspense>
  )
}
