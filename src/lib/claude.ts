import Anthropic from '@anthropic-ai/sdk'

// server: NEXT_PUBLIC_ 접두어 미사용으로 클라이언트 번들에 포함되지 않음.
// API Route / Server Component에서만 import할 것.
// 말투 자연스러움이 핵심 차별점이라 생성 품질 우선 → Sonnet 4.6 (1인 personal 볼륨, 건당 ~₩40)
const MODEL = 'claude-sonnet-4-6'
const MAX_TOKENS = 4096

function getClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    throw new Error(
      'ANTHROPIC_API_KEY 환경변수가 설정되지 않았습니다. .env.local을 확인하세요.',
    )
  }
  return new Anthropic({ apiKey })
}

// system 프롬프트는 대체로 길고 반복 사용되므로(말투 프로파일 등) prompt caching 적용.
// 4096 토큰 미만이면 캐싱이 조용히 비활성화될 뿐 오류는 없음.
function buildSystem(
  system: string,
): Anthropic.TextBlockParam[] | undefined {
  if (!system) return undefined
  return [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }]
}

function extractText(response: Anthropic.Message): string {
  const text = response.content.find((b) => b.type === 'text')?.text
  if (!text) throw new Error('Claude가 텍스트 응답을 반환하지 않았습니다.')
  return text
}

// ── 1. askClaude ─────────────────────────────────────────────────────────────

export async function askClaude({
  system,
  user,
}: {
  system: string
  user: string
}): Promise<string> {
  try {
    const response = await getClient().messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: buildSystem(system),
      messages: [{ role: 'user', content: user }],
    })
    return extractText(response)
  } catch (err) {
    throw err instanceof Error ? err : new Error(String(err))
  }
}

// ── 2. askClaudeJSON ──────────────────────────────────────────────────────────

const JSON_ENFORCEMENT =
  '\n\n반드시 유효한 JSON만 출력. 마크다운 코드펜스·설명 금지.'

function stripFences(raw: string): string {
  return raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
}

function parseJSON<T>(raw: string): T {
  return JSON.parse(stripFences(raw)) as T
}

export async function askClaudeJSON<T>({
  system,
  user,
}: {
  system: string
  user: string
}): Promise<T> {
  const forcedSystem = system + JSON_ENFORCEMENT

  async function attempt(): Promise<string> {
    const response = await getClient().messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: buildSystem(forcedSystem),
      messages: [{ role: 'user', content: user }],
    })
    return extractText(response)
  }

  try {
    const raw = await attempt()
    try {
      return parseJSON<T>(raw)
    } catch {
      // 1회 재시도
      const raw2 = await attempt()
      return parseJSON<T>(raw2)
    }
  } catch (err) {
    throw err instanceof Error ? err : new Error(String(err))
  }
}

// ── 3. askClaudeVision ────────────────────────────────────────────────────────

export type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'

export async function askClaudeVision({
  system,
  user,
  imageBase64,
  mediaType,
}: {
  system: string
  user: string
  imageBase64: string
  mediaType: ImageMediaType
}): Promise<string> {
  try {
    const response = await getClient().messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: buildSystem(system),
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mediaType,
                data: imageBase64,
              },
            },
            { type: 'text', text: user },
          ],
        },
      ],
    })
    return extractText(response)
  } catch (err) {
    throw err instanceof Error ? err : new Error(String(err))
  }
}
