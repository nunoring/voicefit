import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { askClaudeVision } from '@/lib/claude'
import type { ImageMediaType } from '@/lib/claude'

interface InterpretResult {
  vision_interpretation: string
  placement_index: number
  generated_paragraph: string
}

const VISION_SYSTEM = `블로그 포스팅용 이미지를 분석하라.
JSON 필드:
- vision_interpretation: 이미지 내용 설명 (2~3문장)
- placement_index: 0=도입부, 1=중반, 2=후반 — 블로그 본문 어느 위치에 어울리는지
- generated_paragraph: 이 이미지를 소개하는 한국어 단락 (3~5문장)`

function mediaTypeFromPath(path: string): ImageMediaType {
  const ext = path.split('.').pop()?.toLowerCase()
  const map: Record<string, ImageMediaType> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
  }
  return map[ext ?? ''] ?? 'image/jpeg'
}

export async function POST(
  req: NextRequest,
  ctx: RouteContext<'/api/posts/[id]/images/interpret'>,
) {
  try {
    const { id } = await ctx.params
    const { image_id } = (await req.json()) as { image_id?: string }

    if (!image_id) return NextResponse.json({ error: 'image_id는 필수입니다.' }, { status: 400 })

    const supabase = createServerClient()

    const { data: img, error: imgErr } = await supabase
      .from('post_images')
      .select('storage_path, public_url')
      .eq('id', image_id)
      .eq('post_id', id)
      .single()

    if (imgErr) throw new Error(imgErr.message)

    const row = img as unknown as { storage_path: string; public_url: string }

    // Supabase Storage에서 이미지 다운로드 → base64 변환
    const { data: blob, error: dlErr } = await supabase.storage
      .from('post-images')
      .download(row.storage_path)

    if (dlErr || !blob) throw new Error(dlErr?.message ?? '이미지 다운로드 실패')

    const buffer = await blob.arrayBuffer()
    const imageBase64 = Buffer.from(buffer).toString('base64')
    const mediaType = mediaTypeFromPath(row.storage_path)

    const result = await askClaudeVision({
      system: VISION_SYSTEM + '\n\n반드시 유효한 JSON만 출력. 마크다운 코드펜스·설명 금지.',
      user: '이 이미지를 분석해 JSON으로 반환하라.',
      imageBase64,
      mediaType,
    })

    // Vision 엔드포인트는 askClaudeVision(텍스트 반환)이므로 수동 파싱
    let parsed: InterpretResult
    try {
      parsed = JSON.parse(
        result.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim(),
      )
    } catch {
      throw new Error(`Vision 모델 응답 파싱 실패: ${result.slice(0, 200)}`)
    }

    const { error: updateErr } = await supabase
      .from('post_images')
      .update({
        vision_interpretation: parsed.vision_interpretation,
        placement_index: parsed.placement_index,
        generated_paragraph: parsed.generated_paragraph,
      })
      .eq('id', image_id)

    if (updateErr) throw new Error(updateErr.message)

    return NextResponse.json(parsed)
  } catch (err) {
    const message = err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
