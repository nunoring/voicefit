import { NextResponse, type NextRequest } from 'next/server'

const COOKIE_NAME = 'voicefit_share_access'

export async function POST(req: NextRequest) {
  const accessCode = process.env.SHARE_ACCESS_CODE
  if (!accessCode) return NextResponse.json({ ok: true })

  const body = await req.json().catch(() => ({})) as { code?: string }
  if (body.code !== accessCode) {
    return NextResponse.json({ error: '테스트 암호가 맞지 않습니다.' }, { status: 401 })
  }

  const res = NextResponse.json({ ok: true })
  res.cookies.set(COOKIE_NAME, accessCode, {
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
    path: '/',
    maxAge: 60 * 60 * 12,
  })
  return res
}
