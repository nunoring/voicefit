import dns from 'node:dns/promises'

export type SupabaseHealthStatus = 'ok' | 'dns_failed' | 'not_configured'

export function getSupabaseHost() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!url) return null
  try {
    return new URL(url).host
  } catch {
    return null
  }
}

export async function checkSupabaseDns(timeoutMs = 1500): Promise<{
  status: SupabaseHealthStatus
  host: string | null
  error?: string
}> {
  const host = getSupabaseHost()
  if (!host || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { status: 'not_configured', host }
  }

  try {
    await Promise.race([
      dns.lookup(host),
      new Promise((_, reject) => setTimeout(() => reject(new Error('DNS lookup timeout')), timeoutMs)),
    ])
    return { status: 'ok', host }
  } catch (err) {
    return {
      status: 'dns_failed',
      host,
      error: err instanceof Error ? err.message.slice(0, 180) : 'unknown error',
    }
  }
}
