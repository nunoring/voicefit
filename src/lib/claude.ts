import OpenAI from 'openai'

// server: NEXT_PUBLIC_ 접두어 미사용으로 클라이언트 번들에 포함되지 않음.
// API Route / Server Component에서만 import할 것.
const MODEL = 'gpt-4.1-nano'
const MAX_TOKENS = 4096

function getClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new Error(
      'OPENAI_API_KEY 환경변수가 설정되지 않았습니다. .env.local을 확인하세요.',
    )
  }
  return new OpenAI({ apiKey })
}

function extractText(response: OpenAI.Chat.ChatCompletion): string {
  const text = response.choices[0]?.message?.content
  if (!text) throw new Error('OpenAI가 텍스트 응답을 반환하지 않았습니다.')
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
    const response = await getClient().chat.completions.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
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
    const response = await getClient().chat.completions.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      // json_object 모드: 모델이 유효한 JSON만 출력하도록 강제
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: forcedSystem },
        { role: 'user', content: user },
      ],
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
    const response = await getClient().chat.completions.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      messages: [
        { role: 'system', content: system },
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: { url: `data:${mediaType};base64,${imageBase64}` },
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
