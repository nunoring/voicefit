'use client'

import { useEffect, useState } from 'react'
import type { Post } from '@/types'

type SystemStatus = {
  db: {
    status: 'ok' | 'dns_failed' | 'query_failed' | 'not_configured'
    host: string | null
    error?: string
  }
  localFallback: {
    active: boolean
    posts: number
    voiceProfiles: number
  }
  env: {
    voiceProfileMock: boolean
    commercePackMock: boolean
    naverAutomation: boolean
    shortsRender: boolean
  }
  checkedAt: string
}

const POST_TYPE_LABEL: Record<string, string> = {
  product: '상품 리뷰',
  daily: '일상 기록',
  review: '방문 후기',
  coupang: '쿠팡 상품평',
  commerce_pack: '커머스 패키지',
}

const PLATFORM_LABEL: Record<string, string> = {
  naver: '네이버',
  tistory: '티스토리',
  manual: '직접 복붙',
}

const WORKFLOWS = [
  {
    title: '블로그 후기',
    desc: '방문 메모와 사진을 넣고 내 말투로 네이버 글 초안 생성',
    href: '/generate?type=review',
  },
  {
    title: '상품 홍보글',
    desc: '쿠팡 URL과 상품 정보를 블로그용 큐레이션 글로 변환',
    href: '/generate?type=commerce_pack',
  },
  {
    title: '말투 분석',
    desc: '블로그 URL을 다시 넣어 줄넘김, 사진 타이밍, 이모티콘 습관 갱신',
    href: '/onboarding',
  },
]

function isSystemStatus(value: unknown): value is SystemStatus {
  if (!value || typeof value !== 'object') return false
  const data = value as { db?: { status?: unknown } }
  return typeof data.db?.status === 'string'
}

function ScoreChip({ score }: { score: number | null }) {
  if (score == null) return null
  const cls =
    score >= 80 ? 'border-emerald-200 bg-emerald-50 text-emerald-700' :
    score >= 60 ? 'border-amber-200 bg-amber-50 text-amber-700' :
    'border-red-200 bg-red-50 text-red-700'
  return <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${cls}`}>말투 {score}점</span>
}

function StatusChip({ status }: { status: string }) {
  const map: Record<string, string> = {
    draft: '초안',
    generating: '생성중',
    scored: '검수 대기',
    reviewing: '검수중',
    published: '발행완료',
  }
  const cls = status === 'published'
    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
    : 'border-gray-200 bg-gray-50 text-gray-600'
  return <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${cls}`}>{map[status] ?? status}</span>
}

function SystemStatusBanner({ status }: { status: SystemStatus | null }) {
  if (!status) return null

  const dbOk = status.db.status === 'ok'
  const dbLabel: Record<SystemStatus['db']['status'], string> = {
    ok: 'DB 연결 정상',
    dns_failed: '로컬 저장 모드',
    query_failed: 'DB 쿼리 확인 필요',
    not_configured: 'DB 설정 없음',
  }

  return (
    <section className={`rounded-lg border px-4 py-3 ${
      dbOk ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'
    }`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className={`text-sm font-semibold ${dbOk ? 'text-emerald-800' : 'text-amber-900'}`}>
            {dbLabel[status.db.status]}
          </p>
          <p className={`mt-0.5 text-xs ${dbOk ? 'text-emerald-700' : 'text-amber-800'}`}>
            {dbOk
              ? 'Supabase에 저장됩니다.'
              : `Supabase가 꺼져 있어 이 PC에 임시 저장 중입니다. 글 ${status.localFallback.posts}개 · 말투 ${status.localFallback.voiceProfiles}개`}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5 text-[11px]">
          <span className="rounded-full bg-white/80 px-2 py-0.5 text-gray-600">말투 mock {status.env.voiceProfileMock ? 'ON' : 'OFF'}</span>
          <span className="rounded-full bg-white/80 px-2 py-0.5 text-gray-600">커머스 mock {status.env.commercePackMock ? 'ON' : 'OFF'}</span>
          <span className="rounded-full bg-white/80 px-2 py-0.5 text-gray-600">쇼츠 {status.env.shortsRender ? 'ON' : '잠금'}</span>
        </div>
      </div>
      {!dbOk && status.db.host && (
        <p className="mt-2 break-all text-[11px] text-amber-700">
          {status.db.host} · {status.db.error ?? status.db.status}
        </p>
      )}
    </section>
  )
}

function getTitle(post: Post): string {
  if (post.post_type === 'product' || post.post_type === 'commerce_pack') {
    const items = (post.product_data_json as { items?: { name?: string }[] } | null)?.items
    const name = items?.[0]?.name?.trim()
    if (name) return name
  }
  if (post.body_text) {
    const title = post.body_text
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line && !/^!\[image-\d+\]/.test(line) && !/^<사진\d+/.test(line))
      ?.replace(/^#+\s*/, '')
      .slice(0, 64)
    if (title) return title
  }
  return post.post_type ? `${POST_TYPE_LABEL[post.post_type] ?? '콘텐츠'} 초안` : '제목 없음'
}

export default function DashboardPage() {
  const [posts, setPosts] = useState<Post[]>([])
  const [loading, setLoading] = useState(true)
  const [latestProfileId, setLatestProfileId] = useState<string | null>(null)
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null)

  useEffect(() => {
    Promise.all([
      fetch('/api/posts').then((res) => res.json()),
      fetch('/api/voice-profiles').then((res) => res.json()),
      fetch('/api/system/status').then((res) => res.json()).catch(() => null),
    ]).then(([postsData, profilesData, statusData]) => {
      setPosts(Array.isArray(postsData) ? postsData : [])
      const profiles = Array.isArray(profilesData) ? profilesData : []
      setLatestProfileId(profiles[0]?.id ?? null)
      setSystemStatus(isSystemStatus(statusData) ? statusData : null)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  const hasProfile = Boolean(latestProfileId)
  const publishedCount = posts.filter((post) => post.status === 'published').length
  const scoredPosts = posts.filter((post) => post.match_score != null)
  const avgScore = scoredPosts.length
    ? Math.round(scoredPosts.reduce((sum, post) => sum + (post.match_score ?? 0), 0) / scoredPosts.length)
    : null
  const reviewReadyCount = posts.filter((post) => post.status === 'scored' || post.status === 'reviewing').length
  const primaryHref = latestProfileId ? `/generate?voice_profile_id=${latestProfileId}` : '/onboarding'

  return (
    <div className="min-h-full bg-[#f7f8f5]">
      <div className="mx-auto max-w-6xl px-4 py-6 sm:py-8">
        <section className="mb-5 rounded-lg border border-gray-200 bg-white px-5 py-5 shadow-sm">
          <div className="grid gap-5 lg:grid-cols-[1.4fr_0.9fr] lg:items-end">
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">5명 폐쇄 테스트용 작업대</p>
              <h1 className="max-w-3xl text-2xl font-bold leading-tight text-gray-950 sm:text-3xl">
                상품 하나를 내 말투의 블로그 글과 채널별 복붙 자료로 바꿉니다.
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-gray-600">
                지금은 쇼츠 자동 제작보다 블로그 글 품질, 사진 배치, 제휴 고지, 말투 점수 검수를 먼저 안정화하는 단계입니다.
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row lg:justify-end">
              <a
                href={primaryHref}
                className="rounded-lg bg-gray-950 px-4 py-2.5 text-center text-sm font-semibold text-white hover:bg-gray-800"
              >
                {hasProfile ? '새 콘텐츠 만들기' : '말투 분석 시작'}
              </a>
              <a
                href="/onboarding"
                className="rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-center text-sm font-semibold text-gray-700 hover:border-gray-300"
              >
                말투 다시 학습
              </a>
            </div>
          </div>
        </section>

        <div className="mb-5">
          <SystemStatusBanner status={systemStatus} />
        </div>

        {!hasProfile && !loading && (
          <section className="mb-5 rounded-lg border border-blue-200 bg-blue-50 px-5 py-4">
            <p className="text-sm font-semibold text-blue-900">먼저 네 블로그 말투를 학습해야 합니다.</p>
            <p className="mt-1 text-sm text-blue-800">블로그 URL 3개를 넣으면 줄넘김, 사진 타이밍, 이모티콘 습관까지 분석합니다.</p>
          </section>
        )}

        {!loading && posts.length > 0 && (
          <section className="mb-5 grid gap-3 md:grid-cols-4">
            {[
              { label: '전체 생성', value: `${posts.length}편`, hint: '로컬/DB 합산' },
              { label: '검수 대기', value: `${reviewReadyCount}편`, hint: '복붙 전 확인' },
              { label: '발행 완료', value: `${publishedCount}편`, hint: '직접 기록 기준' },
              { label: '평균 말투', value: avgScore != null ? `${avgScore}점` : '-', hint: '75점 미만 발행 차단' },
            ].map(({ label, value, hint }) => (
              <div key={label} className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                <p className="text-xs font-medium text-gray-500">{label}</p>
                <p className="mt-1 text-2xl font-bold text-gray-950">{value}</p>
                <p className="mt-1 text-xs text-gray-400">{hint}</p>
              </div>
            ))}
          </section>
        )}

        <section className="mb-5 grid gap-3 md:grid-cols-3">
          {WORKFLOWS.map((workflow) => (
            <a
              key={workflow.title}
              href={latestProfileId && workflow.href.startsWith('/generate')
                ? `${workflow.href}&voice_profile_id=${latestProfileId}`
                : workflow.href}
              className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-gray-300 hover:shadow-md"
            >
              <p className="text-sm font-semibold text-gray-950">{workflow.title}</p>
              <p className="mt-2 min-h-10 text-sm leading-5 text-gray-600">{workflow.desc}</p>
            </a>
          ))}
        </section>

        <section className="rounded-lg border border-gray-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold text-gray-950">최근 작업</h2>
              <p className="mt-0.5 text-xs text-gray-500">검수 버튼으로 들어가 복사·발행 전 마지막 확인을 합니다.</p>
            </div>
          </div>

          {loading ? (
            <div className="py-16 text-center text-sm text-gray-400">불러오는 중...</div>
          ) : posts.length === 0 ? (
            <div className="px-4 py-14 text-center">
              <p className="text-sm font-medium text-gray-700">아직 생성한 글이 없습니다.</p>
              <a href={primaryHref} className="mt-3 inline-block rounded-lg bg-gray-950 px-4 py-2 text-sm font-semibold text-white">
                첫 콘텐츠 만들기
              </a>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {posts.map((post) => (
                <article key={post.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-gray-900">{getTitle(post)}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <span className="text-xs text-gray-400">{new Date(post.created_at).toLocaleDateString('ko-KR')}</span>
                      {post.post_type && <span className="text-xs text-gray-500">{POST_TYPE_LABEL[post.post_type] ?? post.post_type}</span>}
                      {post.publish_platform && <span className="text-xs text-gray-400">{PLATFORM_LABEL[post.publish_platform]}</span>}
                      <StatusChip status={post.status} />
                      <ScoreChip score={post.match_score} />
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {post.published_url && (
                      <a
                        href={post.published_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded-md border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
                      >
                        보기
                      </a>
                    )}
                    <a
                      href={`/review?post_id=${post.id}`}
                      className="rounded-md border border-gray-900 bg-gray-950 px-3 py-1.5 text-xs font-semibold text-white hover:bg-gray-800"
                    >
                      검수
                    </a>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
