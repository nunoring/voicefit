import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { checkSupabaseDns } from '@/lib/supabase-health'
import { listLocalPosts } from '@/lib/local-posts'
import { listLocalVoiceProfiles } from '@/lib/local-voice-profiles'

type DbStatus = 'ok' | 'dns_failed' | 'query_failed' | 'not_configured'

export async function GET() {
  if (process.env.VERCEL) {
    return NextResponse.json({ disabled: true }, { status: 404 })
  }

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

  const dnsHealth = await checkSupabaseDns()
  let db: { status: DbStatus; host: string | null; error?: string } = dnsHealth

  if (dnsHealth.status === 'ok') {
    try {
      const supabase = createServerClient()
      const { error } = await supabase.from('posts').select('id', { head: true, count: 'exact' }).limit(1)
      db = error
        ? { status: 'query_failed', host: dnsHealth.host, error: error.message.slice(0, 180) }
        : { status: 'ok', host: dnsHealth.host }
    } catch (err) {
      db = { status: 'query_failed', host: dnsHealth.host, error: err instanceof Error ? err.message.slice(0, 180) : 'unknown error' }
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
