import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { readFile, stat } from 'node:fs/promises'
import { getShortsVideoPath } from '@/lib/shorts-video-renderer'

export const runtime = 'nodejs'

export async function GET(_req: NextRequest, ctx: RouteContext<'/api/posts/[id]/shorts/video'>) {
  try {
    const { id } = await ctx.params
    const outputPath = getShortsVideoPath(id)
    const [buffer, info] = await Promise.all([readFile(outputPath), stat(outputPath)])
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Length': String(info.size),
        'Content-Disposition': 'attachment; filename="voicefit-shorts.mp4"',
        'Cache-Control': 'no-store',
      },
    })
  } catch {
    return NextResponse.json({ error: '생성된 쇼츠 MP4가 없습니다. 먼저 쇼츠 MP4 생성을 실행하세요.' }, { status: 404 })
  }
}
