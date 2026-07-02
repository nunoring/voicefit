import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { NextResponse } from 'next/server'
import { resolveLocalImagePath } from '@/lib/local-post-images'

function contentTypeFromFile(fileName: string): string {
  const ext = path.extname(fileName).toLowerCase()
  if (ext === '.png') return 'image/png'
  if (ext === '.gif') return 'image/gif'
  if (ext === '.webp') return 'image/webp'
  return 'image/jpeg'
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ path: string[] }> },
) {
  try {
    const { path: parts } = await ctx.params
    const [postId, fileName] = parts ?? []
    if (!postId || !fileName || parts.length !== 2) {
      return NextResponse.json({ error: 'Invalid image path' }, { status: 400 })
    }

    const filePath = resolveLocalImagePath(postId, fileName)
    const file = await readFile(filePath)
    return new NextResponse(new Uint8Array(file), {
      headers: {
        'Content-Type': contentTypeFromFile(fileName),
        'Cache-Control': 'private, max-age=3600',
      },
    })
  } catch {
    return NextResponse.json({ error: 'Image not found' }, { status: 404 })
  }
}
