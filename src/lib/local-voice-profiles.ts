import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { ProfileJson, VoiceProfile } from '@/types'

const STORE_DIR = path.join(process.cwd(), '.voicefit-local')
const STORE_FILE = path.join(STORE_DIR, 'voice-profiles.json')

async function readProfiles(): Promise<VoiceProfile[]> {
  try {
    const raw = await readFile(STORE_FILE, 'utf8')
    return JSON.parse(raw) as VoiceProfile[]
  } catch {
    return []
  }
}

async function writeProfiles(profiles: VoiceProfile[]) {
  await mkdir(STORE_DIR, { recursive: true })
  await writeFile(STORE_FILE, JSON.stringify(profiles, null, 2), 'utf8')
}

export async function listLocalVoiceProfiles() {
  const profiles = await readProfiles()
  return profiles
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map(({ id, name, created_at, profile_json }) => ({ id, name, created_at, profile_json }))
}

export async function getLocalVoiceProfile(id: string) {
  const profiles = await readProfiles()
  return profiles.find((profile) => profile.id === id) ?? null
}

export async function insertLocalVoiceProfile(input: {
  name: string
  source_text: string
  profile_json: ProfileJson
  reusable_system_prompt: string
}) {
  const profiles = await readProfiles()
  const now = new Date().toISOString()
  const profile: VoiceProfile = {
    id: `local_${randomUUID()}`,
    user_id: null,
    name: input.name,
    source_text: input.source_text,
    profile_json: input.profile_json,
    reusable_system_prompt: input.reusable_system_prompt,
    created_at: now,
    updated_at: now,
  }
  profiles.unshift(profile)
  await writeProfiles(profiles)
  return profile
}

export async function updateLocalVoiceProfileName(id: string, name: string) {
  const profiles = await readProfiles()
  const index = profiles.findIndex((profile) => profile.id === id)
  if (index < 0) return null
  profiles[index] = { ...profiles[index], name, updated_at: new Date().toISOString() }
  await writeProfiles(profiles)
  return profiles[index]
}

export async function deleteLocalVoiceProfile(id: string) {
  const profiles = await readProfiles()
  const next = profiles.filter((profile) => profile.id !== id)
  await writeProfiles(next)
  return next.length !== profiles.length
}

export function buildMockProfile(sourceText: string): ProfileJson {
  const avg = Math.max(18, Math.min(70, Math.round(sourceText.length / Math.max(1, sourceText.split(/[.!?。！？\n]+/).filter(Boolean).length))))
  return {
    tone: 'friendly, practical, first-person blog tone',
    formality: 'casual polite Korean blog style',
    avg_sentence_length: avg,
    sentence_endings: ['~요', '~더라고요', '~했습니다'],
    signature_phrases: ['오늘은', '개인적으로', '한번 정리해볼게요'],
    emoji_usage: 'light',
    emoji_position: '문단 끝에만 가볍게',
    emoji_timing: '좋았던 점을 말한 뒤나 마무리 문장 뒤에만',
    photo_timing: '핵심 설명 블록 뒤에 사진 1장',
    paragraph_length: '짧게 끊어쓰기(1~3줄)',
    spacing_style: '블로그식 띄어쓰기, 너무 교정된 문어체 금지',
    line_break_style: '문장 1~2개마다 줄바꿈, 강조 문장은 단독 한 줄',
    heading_usage: '짧은 소제목을 가끔 사용',
    photo_comment_style: '사진 앞뒤로 짧은 맥락 한마디만 붙임',
    punctuation_style: '느낌표와 ㅋㅋ는 적게, 쉼표로 자연스럽게 호흡 조절',
    ai_tell_risks: ['문단 길이가 전부 균일함', '사진마다 똑같은 코멘트', '광고 카피처럼 정돈된 CTA'],
    vocabulary_notes: 'concrete experience words, location/product details, mild recommendations',
    do_list: ['write in short paragraphs', 'keep practical details', 'avoid overclaiming'],
    dont_list: ['do not invent direct experience', 'do not overuse hype', 'do not sound like an ad'],
  }
}

export function buildMockReusableSystemPrompt(profile: ProfileJson) {
  return [
    'Write in a friendly Korean blog voice based on this profile.',
    `Tone: ${profile.tone}`,
    `Formality: ${profile.formality}`,
    `Emoji timing: ${profile.emoji_timing ?? profile.emoji_position ?? 'follow the source text only'}`,
    `Photo timing: ${profile.photo_timing ?? 'place photos only where the writing naturally calls for them'}`,
    `Paragraphs: ${profile.paragraph_length ?? 'short blog paragraphs'}`,
    `Line breaks: ${profile.line_break_style ?? 'follow the source text rhythm'}`,
    `Spacing: ${profile.spacing_style ?? 'natural Korean blog spacing'}`,
    `Punctuation: ${profile.punctuation_style ?? 'do not over-polish punctuation'}`,
    `AI tell risks to avoid: ${(profile.ai_tell_risks ?? []).join(', ') || 'generic balanced AI paragraphs'}`,
    'Use concrete observations, natural transitions, and restrained recommendations.',
    'Do not invent personal usage claims or unverifiable facts.',
  ].join('\n')
}
