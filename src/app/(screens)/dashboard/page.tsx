'use client'

import { useState, useEffect } from 'react'
import type { Post, PostType } from '@/types'

const POST_TYPE_LABEL: Record<string, string> = {
  product: '🛍️ 상품 리뷰',
  daily:   '☀️ 일상 기록',
  review:  '⭐ 경험 리뷰',
}

const PLATFORM_LABEL: Record<string, string> = {
  naver:   '네이버',
  tistory: '티스토리',
  manual:  '직접 복붙',
}

function ScoreChip({ score }: { score: number | null }) {
  if (score == null) return null
  const cls =
    score >= 80 ? 'bg-green-100 text-green-700' :
    score >= 60 ? 'bg-yellow-100 text-yellow-700' :
    'bg-red-100 text-red-700'
  return <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${cls}`}>말투 {score}점</span>
}

function StatusChip({ status }: { status: string }) {
  const map: Record<string, string> = {
    draft: '초안',
    generating: '생성중',
    scored: '채점완료',
    reviewing: '검수중',
    published: '발행완료',
  }
  const cls = status === 'published' ? 'text-green-600' : 'text-gray-400'
  return <span className={`text-xs ${cls}`}>{map[status] ?? status}</span>
}

export default function DashboardPage() {
  const [posts, setPosts] = useState<Post[]>([])
  const [loading, setLoading] = useState(true)
  const [latestProfileId, setLatestProfileId] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([
      fetch('/api/posts').then((r) => r.json()),
      fetch('/api/voice-profiles').then((r) => r.json()),
    ]).then(([postsData, profilesData]) => {
      setPosts(Array.isArray(postsData) ? postsData : [])
      const profiles = Array.isArray(profilesData) ? profilesData : []
      setLatestProfileId(profiles[0]?.id ?? null)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  const hasProfile = !!latestProfileId

  const publishedCount = posts.filter((p) => p.status === 'published').length
  const avgScore = posts.filter((p) => p.match_score != null).length
    ? Math.round(posts.filter((p) => p.match_score != null).reduce((s, p) => s + (p.match_score ?? 0), 0) / posts.filter((p) => p.match_score != null).length)
    : null

  const getTitle = (post: Post): string => {
    if (post.post_type === 'product') {
      const items = (post.product_data_json as { items?: { name: string }[] } | null)?.items
      return items?.[0]?.name ?? '상품 리뷰'
    }
    if (post.body_text) {
      return post.body_text.split('\n').find((l) => l.trim())?.replace(/^#+\s*/, '').slice(0, 40) ?? '글'
    }
    return '제목 없음'
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">내 글 목록</h1>
          <p className="mt-1 text-sm text-gray-500">생성하고 발행한 블로그 글을 관리하세요.</p>
        </div>
        <a
          href={latestProfileId ? `/generate?voice_profile_id=${latestProfileId}` : '/onboarding'}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
        >
          {hasProfile ? '+ 새 글 쓰기' : '말투 분석 시작'}
        </a>
      </div>

      {/* 첫 방문자 안내 */}
      {!hasProfile && !loading && (
        <div className="mb-6 rounded-xl border border-blue-100 bg-blue-50 p-5">
          <p className="font-semibold text-blue-800">처음 오셨군요!</p>
          <p className="mt-1 text-sm text-blue-700">
            내 블로그 글 URL을 넣으면 AI가 말투를 학습해요.<br/>
            학습 후 어떤 주제든 내 말투로 글을 자동 생성합니다.
          </p>
          <a href="/onboarding" className="mt-3 inline-block rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">
            말투 분석 시작하기 →
          </a>
        </div>
      )}


      {/* 요약 카드 */}
      {!loading && posts.length > 0 && (
        <div className="mb-6 grid grid-cols-3 gap-3">
          {[
            { label: '전체 생성', value: posts.length + '편' },
            { label: '발행 완료', value: publishedCount + '편' },
            { label: '평균 말투 점수', value: avgScore != null ? avgScore + '점' : '-' },
          ].map(({ label, value }) => (
            <div key={label} className="rounded-xl border border-gray-100 bg-white p-4 text-center shadow-sm">
              <p className="text-2xl font-bold text-gray-900">{value}</p>
              <p className="mt-0.5 text-xs text-gray-500">{label}</p>
            </div>
          ))}
        </div>
      )}

      {/* 글 목록 */}
      {loading ? (
        <div className="py-12 text-center text-sm text-gray-400">불러오는 중…</div>
      ) : posts.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-gray-200 py-16 text-center">
          <p className="text-sm text-gray-500">아직 생성한 글이 없어요.</p>
          <a href="/generate" className="mt-3 inline-block text-sm text-blue-600 hover:underline">첫 글 써보기 →</a>
        </div>
      ) : (
        <div className="space-y-2">
          {posts.map((post) => (
            <div key={post.id} className="flex items-center gap-3 rounded-xl border border-gray-100 bg-white px-4 py-3 shadow-sm">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-gray-800">{getTitle(post)}</p>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <span className="text-xs text-gray-400">
                    {new Date(post.created_at).toLocaleDateString('ko-KR')}
                  </span>
                  {post.post_type && (
                    <span className="text-xs text-gray-500">{POST_TYPE_LABEL[post.post_type] ?? post.post_type}</span>
                  )}
                  {post.publish_platform && (
                    <span className="text-xs text-gray-400">{PLATFORM_LABEL[post.publish_platform]}</span>
                  )}
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
                    className="rounded border border-gray-200 px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50"
                  >
                    보기
                  </a>
                )}
                <a
                  href={`/review?post_id=${post.id}`}
                  className="rounded border border-gray-200 px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50"
                >
                  검수
                </a>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
