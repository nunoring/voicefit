import { spawn } from 'node:child_process'
import { mkdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { buildAssSubtitles, type ShortsRenderPlan } from '@/lib/shorts-render-plan'

export interface RenderedShortsVideo {
  outputPath: string
  sizeBytes: number
  durationSec: number
}

function safePostId(postId: string): string {
  return postId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120)
}

export function getShortsWorkDir(postId: string): string {
  return path.join(process.cwd(), '.voicefit-local', 'shorts', safePostId(postId))
}

export function getShortsVideoPath(postId: string): string {
  return path.join(getShortsWorkDir(postId), 'shorts.mp4')
}

function runFfmpeg(args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', args, { cwd, windowsHide: true })
    let stderr = ''
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`ffmpeg exited with ${code}: ${stderr.slice(-2000)}`))
      }
    })
  })
}

export async function renderShortsVideo(plan: ShortsRenderPlan, postId: string): Promise<RenderedShortsVideo> {
  const workDir = getShortsWorkDir(postId)
  await mkdir(workDir, { recursive: true })

  const subtitlePath = path.join(workDir, 'captions.ass')
  const outputPath = getShortsVideoPath(postId)
  await writeFile(subtitlePath, buildAssSubtitles(plan), 'utf8')

  const duration = Math.max(8, Math.ceil(plan.durationSec))
  await runFfmpeg([
    '-y',
    '-f', 'lavfi',
    '-i', `color=c=0x111827:s=${plan.size.width}x${plan.size.height}:r=${plan.fps}:d=${duration}`,
    '-f', 'lavfi',
    '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
    '-t', String(duration),
    '-map', '0:v:0',
    '-map', '1:a:0',
    '-vf', 'ass=captions.ass',
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '23',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '96k',
    '-shortest',
    '-movflags', '+faststart',
    'shorts.mp4',
  ], workDir)

  const info = await stat(outputPath)
  return { outputPath, sizeBytes: info.size, durationSec: duration }
}
