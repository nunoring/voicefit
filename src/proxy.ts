import { NextResponse, type NextRequest } from 'next/server'

const COOKIE_NAME = 'voicefit_share_access'

function handleShareAccess(req: NextRequest) {
  const accessCode = process.env.SHARE_ACCESS_CODE
  if (!accessCode) return NextResponse.next()

  const { pathname, search } = req.nextUrl
  if (
    pathname === '/access' ||
    pathname === '/api/access' ||
    pathname.startsWith('/_next') ||
    pathname === '/favicon.ico'
  ) {
    return NextResponse.next()
  }

  const cookie = req.cookies.get(COOKIE_NAME)?.value
  if (cookie === accessCode) return NextResponse.next()

  const url = req.nextUrl.clone()
  url.pathname = '/access'
  url.searchParams.set('next', pathname === '/' ? '/dashboard' : `${pathname}${search}`)
  return NextResponse.redirect(url)
}

export { handleShareAccess as proxy }
export default handleShareAccess

export const config = {
  matcher: ['/((?!.*\\..*).*)'],
}
