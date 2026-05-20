// node scripts/verify-db.mjs
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dir = dirname(fileURLToPath(import.meta.url))
const env = readFileSync(resolve(__dir, '../.env.local'), 'utf8')
  .split('\n')
  .reduce((acc, line) => {
    const [k, ...v] = line.split('=')
    if (k && v.length) acc[k.trim()] = v.join('=').trim()
    return acc
  }, {})

const url = env.NEXT_PUBLIC_SUPABASE_URL
const key = env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !key) {
  console.error('❌  .env.local에 SUPABASE URL / SERVICE_ROLE_KEY가 없습니다.')
  process.exit(1)
}

const sb = createClient(url, key)

const TABLES = ['voice_profiles', 'posts', 'post_images']

console.log(`\n🔗  연결 대상: ${url}\n`)

let allOk = true

for (const table of TABLES) {
  const { error } = await sb.from(table).select('id').limit(1)
  if (error) {
    console.error(`❌  ${table}: ${error.message}`)
    allOk = false
  } else {
    console.log(`✅  ${table} — OK`)
  }
}

// Storage 버킷 확인
const { data: buckets, error: bucketErr } = await sb.storage.listBuckets()
if (bucketErr) {
  console.error(`❌  storage.listBuckets: ${bucketErr.message}`)
  allOk = false
} else {
  const found = buckets.some(b => b.id === 'post-images')
  if (found) console.log(`✅  storage bucket 'post-images' — OK`)
  else { console.error(`❌  storage bucket 'post-images' 없음`); allOk = false }
}

console.log(allOk ? '\n✅  모든 검증 통과!\n' : '\n❌  일부 항목 실패 — SQL이 정상 실행됐는지 확인하세요.\n')
process.exit(allOk ? 0 : 1)
