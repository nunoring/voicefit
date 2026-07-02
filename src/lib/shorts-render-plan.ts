import { splitCommerceSections } from '@/lib/commerce-pack'

export interface ShortsRenderScene {
  index: number
  startSec: number
  endSec: number
  narration: string
  caption: string
  visualHint: string
}

export interface ShortsRenderAsset {
  role: 'product_image' | 'info_card'
  label: string
  sourceUrl: string | null
  prompt: string
}

export interface ShortsRenderPlan {
  format: 'youtube_shorts'
  size: { width: 1080; height: 1920 }
  fps: 30
  durationSec: number
  title: string
  goal: string
  hook: string
  voiceTone: string
  brollHint: string
  cutTiming: string
  disclosureOverlay: string | null
  assets: ShortsRenderAsset[]
  scenes: ShortsRenderScene[]
}

interface BuildPlanOptions {
  productName?: string | null
  productImageUrls?: string[]
}

const DEFAULT_SCENE_SECONDS = 4

function cleanLine(text: string): string {
  return text
    .replace(/^\s*[-*]\s*/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function cleanNarration(text: string): string {
  return cleanLine(text)
    .replace(/\((?:[^)]*쿠팡[^)]*|[^)]*제휴[^)]*|[^)]*광고[^)]*)\)/g, '제휴 링크 포함')
    .replace(/\s+/g, ' ')
    .trim()
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function stripQuotes(text: string): string {
  return text.replace(/^["“”']+|["“”']+$/g, '').trim()
}

function extractBriefField(brief: string, label: string): string {
  const re = new RegExp(`(?:^|\\n)\\s*-\\s*${escapeRegExp(label)}\\s*:\\s*(.+)`)
  return stripQuotes(re.exec(brief)?.[1]?.trim() ?? '')
}

function extractTitle(markdown: string, productName?: string | null): string {
  if (productName?.trim()) return productName.trim()
  const blog = splitCommerceSections(markdown)['블로그 글'] ?? ''
  const h1 = /^#\s+(.+?)\s*$/m.exec(blog)?.[1]?.trim()
  return h1 || 'VoiceFit 쇼츠'
}

function extractSceneHints(brief: string): string[] {
  const sceneBlock = /-\s*장면 구성\s*:\s*([\s\S]*?)(?:\n-\s*(?:자막 규칙|B-roll\/이미지|TTS 톤|컷 타이밍|수동 보정)\s*:|$)/.exec(brief)?.[1] ?? ''
  return sceneBlock
    .split('\n')
    .map((line) => line.replace(/^\s*\d+\.\s*/, '').trim())
    .filter(Boolean)
}

function parseTimedScript(script: string): ShortsRenderScene[] {
  const lines = script.split('\n').map(cleanLine).filter(Boolean)
  const scenes: ShortsRenderScene[] = []

  for (const line of lines) {
    const match = /^\[(\d{1,3})\s*(?:[-~]\s*(\d{1,3}))?\s*초\]\s*(.+)$/.exec(line)
    if (!match) continue
    const startSec = Number(match[1])
    const endSec = Math.max(startSec + 2, Number(match[2] ?? startSec + DEFAULT_SCENE_SECONDS))
    const narration = cleanNarration(match[3])
    scenes.push({
      index: scenes.length + 1,
      startSec,
      endSec,
      narration,
      caption: narration,
      visualHint: '',
    })
  }

  if (scenes.length) return scenes

  return lines.slice(0, 5).map((line, index) => {
    const startSec = index * DEFAULT_SCENE_SECONDS
    const narration = cleanNarration(line)
    return {
      index: index + 1,
      startSec,
      endSec: startSec + DEFAULT_SCENE_SECONDS,
      narration,
      caption: narration,
      visualHint: '',
    }
  })
}

export function wrapCaptionText(text: string, maxChars = 14, maxLines = 3): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (!normalized) return ''
  const lines: string[] = []
  let current = ''

  for (const word of normalized.split(' ')) {
    if (word.length > maxChars) {
      if (current) {
        lines.push(current)
        current = ''
      }
      for (let i = 0; i < word.length; i += maxChars) {
        lines.push(word.slice(i, i + maxChars))
      }
      continue
    }
    const next = current ? `${current} ${word}` : word
    if (next.length > maxChars && current) {
      lines.push(current)
      current = word
    } else {
      current = next
    }
  }

  if (current) lines.push(current)
  return lines.slice(0, maxLines).join('\n')
}

export function buildShortsRenderPlan(markdown: string, options: BuildPlanOptions = {}): ShortsRenderPlan {
  const sections = splitCommerceSections(markdown)
  const script = sections['쇼츠 대본'] ?? ''
  const brief = sections['쇼츠 제작 지시서'] ?? ''
  const title = extractTitle(markdown, options.productName)
  const goal = extractBriefField(brief, '목표') || `${title}의 핵심 정보를 짧게 전달하기`
  const hook = extractBriefField(brief, '0~3초 후킹') || ''
  const brollHint = extractBriefField(brief, 'B-roll/이미지') || '상품 이미지 또는 정보 카드'
  const voiceTone = extractBriefField(brief, 'TTS 톤') || '차분한 정보 제공자 톤'
  const cutTiming = extractBriefField(brief, '컷 타이밍') || '3~4초마다 컷 전환'
  const sceneHints = extractSceneHints(brief)
  const scenes = parseTimedScript(script).map((scene, index) => ({
    ...scene,
    visualHint: sceneHints[index] || brollHint,
  }))
  const durationSec = Math.max(8, Math.ceil(Math.max(...scenes.map((scene) => scene.endSec), 0)))
  const hasDisclosure = /쿠팡\s*파트너스|제휴\s*링크|제휴\s*고지|#광고/.test(markdown)
  const productImages = (options.productImageUrls ?? []).filter(Boolean).slice(0, 3)
  const assets: ShortsRenderAsset[] = [
    ...productImages.map((sourceUrl, index) => ({
      role: 'product_image' as const,
      label: `상품 이미지 ${index + 1}`,
      sourceUrl,
      prompt: brollHint,
    })),
    {
      role: 'info_card',
      label: '가격/구성 정보 카드',
      sourceUrl: null,
      prompt: brollHint,
    },
  ]

  return {
    format: 'youtube_shorts',
    size: { width: 1080, height: 1920 },
    fps: 30,
    durationSec,
    title,
    goal,
    hook,
    voiceTone,
    brollHint,
    cutTiming,
    disclosureOverlay: hasDisclosure ? '제휴 링크 포함 콘텐츠' : null,
    assets,
    scenes,
  }
}

function assTime(sec: number): string {
  const safe = Math.max(0, sec)
  const h = Math.floor(safe / 3600)
  const m = Math.floor((safe % 3600) / 60)
  const s = Math.floor(safe % 60)
  const cs = Math.floor((safe - Math.floor(safe)) * 100)
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`
}

function escapeAssText(text: string): string {
  return text
    .replace(/[{}]/g, '')
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\N')
}

export function buildAssSubtitles(plan: ShortsRenderPlan): string {
  const events: string[] = []
  const titleText = wrapCaptionText(plan.title, 16, 2)
  const goalText = wrapCaptionText(plan.goal, 18, 2)

  events.push(`Dialogue: 0,${assTime(0)},${assTime(plan.durationSec)},Title,,0,0,0,,${escapeAssText(titleText)}`)
  events.push(`Dialogue: 0,${assTime(0)},${assTime(Math.min(4, plan.durationSec))},Goal,,0,0,0,,${escapeAssText(goalText)}`)
  if (plan.disclosureOverlay) {
    events.push(`Dialogue: 0,${assTime(0)},${assTime(Math.min(5, plan.durationSec))},Disclosure,,0,0,0,,${escapeAssText(plan.disclosureOverlay)}`)
  }

  for (const scene of plan.scenes) {
    const text = wrapCaptionText(scene.caption, 14, 3)
    const visualHint = wrapCaptionText(scene.visualHint, 20, 2)
    if (visualHint) {
      events.push(`Dialogue: 0,${assTime(scene.startSec)},${assTime(scene.endSec)},VisualHint,,0,0,0,,${escapeAssText(visualHint)}`)
    }
    events.push(`Dialogue: 0,${assTime(scene.startSec)},${assTime(scene.endSec)},Caption,,0,0,0,,${escapeAssText(text)}`)
  }

  return `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Title,Malgun Gothic,62,&H00FFFFFF,&H000000FF,&HAA000000,&H8A111827,1,0,0,0,100,100,0,0,3,6,0,8,90,90,155,1
Style: Goal,Malgun Gothic,42,&H00D1FAE5,&H000000FF,&HAA000000,&H80111827,0,0,0,0,100,100,0,0,3,4,0,8,90,90,315,1
Style: VisualHint,Malgun Gothic,38,&H00BFDBFE,&H000000FF,&HAA000000,&H70111827,0,0,0,0,100,100,0,0,3,3,0,2,100,100,390,1
Style: Caption,Malgun Gothic,78,&H00FFFFFF,&H000000FF,&HAA000000,&H88111827,1,0,0,0,100,100,0,0,3,6,0,5,95,95,0,1
Style: Disclosure,Malgun Gothic,36,&H00E5E7EB,&H000000FF,&HAA000000,&H80111827,0,0,0,0,100,100,0,0,3,3,0,2,90,90,170,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${events.join('\n')}
`
}
