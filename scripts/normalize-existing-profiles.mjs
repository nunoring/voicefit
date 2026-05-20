/**
 * normalize-existing-profiles.mjs
 *
 * 1회성 DB 정리 도구.
 * 이미 저장된 voice_profiles의 profile_json에 중첩 객체가 섞인 경우
 * 모두 flat 문자열/배열로 정규화한다.
 *
 * 실행: node scripts/normalize-existing-profiles.mjs
 *
 * ⚠️  자동 실행하지 말 것 — 수동 1회 실행 전용.
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

// ── 환경변수 로드 ─────────────────────────────────────────────────────────────

const __dir = dirname(fileURLToPath(import.meta.url))
const envPath = resolve(__dir, '../.env.local')

const env = readFileSync(envPath, 'utf8')
  .split('\n')
  .reduce((acc, line) => {
    const eq = line.indexOf('=')
    if (eq < 1 || line.trim().startsWith('#')) return acc
    acc[line.slice(0, eq).trim()] = line.slice(eq + 1).trim()
    return acc
  }, {})

const url = env.NEXT_PUBLIC_SUPABASE_URL
const key = env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !key) {
  console.error('❌  NEXT_PUBLIC_SUPABASE_URL 또는 SUPABASE_SERVICE_ROLE_KEY 누락')
  process.exit(1)
}

const sb = createClient(url, key)

// ── 정규화 로직 (voice-profiles/route.ts와 동일) ─────────────────────────────

function flattenToString(value) {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value === null || value === undefined) return ''
  if (Array.isArray(value)) return value.map(flattenToString).join(', ')
  if (typeof value === 'object') {
    return Object.entries(value)
      .map(([k, v]) => `${k}: ${flattenToString(v)}`)
      .join(', ')
  }
  return JSON.stringify(value)
}

function normalizeArray(val) {
  if (!Array.isArray(val)) return []
  return val.map(flattenToString)
}

function normalizeProfileJson(raw) {
  const r = raw ?? {}
  return {
    tone:               flattenToString(r.tone),
    formality:          flattenToString(r.formality),
    avg_sentence_length: isNaN(Number(r.avg_sentence_length)) ? 0 : Number(r.avg_sentence_length),
    sentence_endings:   normalizeArray(r.sentence_endings),
    signature_phrases:  normalizeArray(r.signature_phrases),
    emoji_usage:        flattenToString(r.emoji_usage),
    vocabulary_notes:   flattenToString(r.vocabulary_notes),
    do_list:            normalizeArray(r.do_list),
    dont_list:          normalizeArray(r.dont_list),
  }
}

function needsNormalization(original, normalized) {
  return JSON.stringify(original) !== JSON.stringify(normalized)
}

// ── 메인 ─────────────────────────────────────────────────────────────────────

const { data: rows, error } = await sb
  .from('voice_profiles')
  .select('id, profile_json')

if (error) {
  console.error('❌  voice_profiles 조회 실패:', error.message)
  process.exit(1)
}

console.log(`\n총 ${rows.length}개 프로파일 확인 중...\n`)

let updated = 0
let skipped = 0

for (const row of rows) {
  const normalized = normalizeProfileJson(row.profile_json)

  if (!needsNormalization(row.profile_json, normalized)) {
    skipped++
    continue
  }

  const { error: updateErr } = await sb
    .from('voice_profiles')
    .update({ profile_json: normalized })
    .eq('id', row.id)

  if (updateErr) {
    console.error(`❌  ${row.id} 업데이트 실패:`, updateErr.message)
  } else {
    console.log(`✅  ${row.id} 정규화 완료`)
    updated++
  }
}

console.log(`\n완료: ${updated}개 업데이트, ${skipped}개 변경 없음.\n`)
