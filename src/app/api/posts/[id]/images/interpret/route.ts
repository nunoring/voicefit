import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { askClaudeVision } from '@/lib/claude'
import type { ImageMediaType } from '@/lib/claude'
import { getLocalPost } from '@/lib/local-posts'
import { getLocalVoiceProfile } from '@/lib/local-voice-profiles'
import { getLocalPostImage, readLocalUploadedImage, updateLocalPostImage } from '@/lib/local-post-images'

interface InterpretResult {
  vision_interpretation: string
  placement_index: number
  generated_paragraph: string
}

const VISION_SYSTEM_BASE = `블로그 포스팅용 이미지를 분석하라.

아래 말투 가이드에 맞춰 블로거 본인이 직접 쓴 것 같은 생생한 표현으로 작성할 것.
"이 이미지는..." 같은 AI 설명체 절대 금지. 블로거가 사진 보며 직접 말하는 톤으로.

예시 (좋음): "고기 때깔 봐요 진짜 🔥 이거 보고 안 시킬 수가 없잖아요"
예시 (나쁨): "이 이미지는 철판 위에서 구워지는 삼겹살의 모습입니다"

JSON 필드:
- vision_interpretation: 이 사진을 보며 블로거가 즉흥적으로 한 마디 한다면? (1~2문장, 블로거 말투로)
- placement_index: 0=도입부, 1=중반, 2=후반 — 블로그 흐름상 어느 위치에 어울리는지
- generated_paragraph: 이 사진을 블로그 본문에서 소개하는 단락 (2~3문장, 블로거 말투로)`

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

function parseVisionResult(result: string): InterpretResult {
  return JSON.parse(
    result.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim(),
  ) as InterpretResult
}

export async function POST(
  req: NextRequest,
  ctx: RouteContext<'/api/posts/[id]/images/interpret'>,
) {
  try {
    const { id } = await ctx.params
    const { image_id } = (await req.json()) as { image_id?: string }

    if (!image_id) return NextResponse.json({ error: 'image_id는 필수입니다.' }, { status: 400 })

    if (id.startsWith('local_post_')) {
      const img = await getLocalPostImage(id, image_id)
      if (!img) return NextResponse.json({ error: '이미지를 찾을 수 없습니다.' }, { status: 404 })

      const post = await getLocalPost(id)
      const profile = post?.voice_profile_id
        ? await getLocalVoiceProfile(post.voice_profile_id)
        : null
      const voicePrompt = profile?.reusable_system_prompt ?? ''

      const buffer = await readLocalUploadedImage(id, img)
      const imageBase64 = buffer.toString('base64')
      const mediaType = mediaTypeFromPath(img.storage_path)

      const system = [
        voicePrompt ? `[블로거 말투 가이드]\n${voicePrompt}\n\n` : '',
        VISION_SYSTEM_BASE,
        '\n\n반드시 유효한 JSON만 출력. 마크다운 코드펜스·설명 금지.',
      ].join('')

      const result = await askClaudeVision({
        system,
        user: '이 이미지를 분석해 JSON으로 반환하라.',
        imageBase64,
        mediaType,
      })

      let parsed: InterpretResult
      try {
        parsed = parseVisionResult(result)
      } catch {
        throw new Error(`Vision 모델 응답 파싱 실패: ${result.slice(0, 200)}`)
      }

      await updateLocalPostImage(image_id, {
        vision_interpretation: parsed.vision_interpretation,
        placement_index: parsed.placement_index,
        generated_paragraph: parsed.generated_paragraph,
      })

      return NextResponse.json(parsed)
    }

    const supabase = createServerClient()

    // 이미지 + 말투 프로파일 병렬 조회
    const [{ data: img, error: imgErr }, { data: postData }] = await Promise.all([
      supabase.from('post_images').select('storage_path, public_url').eq('id', image_id).eq('post_id', id).single(),
      supabase.from('posts').select('voice_profiles(reusable_system_prompt)').eq('id', id).single(),
    ])

    if (imgErr) throw new Error(imgErr.message)

    const row = img as unknown as { storage_path: string; public_url: string }
    const voicePrompt = (postData as unknown as { voice_profiles?: { reusable_system_prompt?: string } | null })
      ?.voice_profiles?.reusable_system_prompt ?? ''

    // Supabase Storage에서 이미지 다운로드 → base64 변환
    const { data: blob, error: dlErr } = await supabase.storage
      .from('post-images')
      .download(row.storage_path)

    if (dlErr || !blob) throw new Error(dlErr?.message ?? '이미지 다운로드 실패')

    const buffer = await blob.arrayBuffer()
    const imageBase64 = Buffer.from(buffer).toString('base64')
    const mediaType = mediaTypeFromPath(row.storage_path)

    // 말투 프로파일을 시스템 프롬프트에 주입
    const system = [
      voicePrompt ? `[블로거 말투 가이드]\n${voicePrompt}\n\n` : '',
      VISION_SYSTEM_BASE,
      '\n\n반드시 유효한 JSON만 출력. 마크다운 코드펜스·설명 금지.',
    ].join('')

    const result = await askClaudeVision({
      system,
      user: '이 이미지를 분석해 JSON으로 반환하라.',
      imageBase64,
      mediaType,
    })

    // Vision 엔드포인트는 askClaudeVision(텍스트 반환)이므로 수동 파싱
    let parsed: InterpretResult
    try {
      parsed = parseVisionResult(result)
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
