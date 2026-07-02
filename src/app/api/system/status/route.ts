import dns from 'node:dns/promises'
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { listLocalPosts } from '@/lib/local-posts'
import { listLocalVoiceProfiles } from '@/lib/local-voice-profiles'

type DbStatus = 'ok' | 'dns_failed' | 'query_failed' | 'not_configured'

function getSupabaseHost() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!url) return null
  try {
    return new URL(url).host
  } catch {
    return null
  }
}

function cleanError(err: unknown) {
  return err instanceof Error ? err.message.slice(0, 180) : 'unknown error'
}

export async function GET() {
  if (process.env.VERCEL) {
    return NextResponse.json({ disabled: true }, { status: 404 })
  }

  const host = getSupabaseHost()
  const env = {
    supabaseUrl: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
    supabaseAnonKey: Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
    supabaseServiceRoleKey: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    anthropicApiKey: Boolean(process.env.ANTHROPIC_API_KEY),
    voiceProfileMock: process.env.VOICE_PROFILE_MOCK === '1',
    commercePackMock: process.env.COMMERCE_PACK_MOCK === '1',
    naverAutomation: process.env.ALLOW_NAVER_AUTOMATION === '1',
    shortsRender: process.env.NEXT_PUBLIC_SHORTS_RENDER_ENABLED === '1',
  }

  let db: { status: DbStatus; host: string | null; error?: string } = {
    status: env.supabaseUrl && env.supabaseServiceRoleKey ? 'query_failed' : 'not_configured',
    host,
  }

  if (host && env.supabaseUrl && env.supabaseServiceRoleKey) {
    try {
      await dns.lookup(host)
      const supabase = createServerClient()
      const { error } = await supabase.from('posts').select('id', { head: true, count: 'exact' }).limit(1)
      db = error
        ? { status: 'query_failed', host, error: error.message.slice(0, 180) }
        : { status: 'ok', host }
    } catch (err) {
      db = { status: 'dns_failed', host, error: cleanError(err) }
    }
  }

  const [localPosts, localProfiles] = await Promise.all([
    listLocalPosts(),
    listLocalVoiceProfiles(),
  ])

  return NextResponse.json({
    db,
    localFallback: {
      active: db.status !== 'ok',
      posts: localPosts.length,
      voiceProfiles: localProfiles.length,
    },
    env,
    checkedAt: new Date().toISOString(),
  })
}
