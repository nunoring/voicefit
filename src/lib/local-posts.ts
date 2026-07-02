import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Post, PostStatus, PostType, ProductData, UsageBasis } from '@/types'

type LocalContentJson = {
  daily_content?: string
  review_place?: string
  review_experience?: string
  coupang_product?: string
  coupang_experience?: string
  usage_basis?: UsageBasis
}

export type LocalPost = Post & {
  content_json: LocalContentJson | null
}

const STORE_DIR = path.join(process.cwd(), '.voicefit-local')
const STORE_FILE = path.join(STORE_DIR, 'posts.json')

async function readPosts(): Promise<LocalPost[]> {
  try {
    const raw = await readFile(STORE_FILE, 'utf8')
    return JSON.parse(raw) as LocalPost[]
  } catch {
    return []
  }
}

async function writePosts(posts: LocalPost[]) {
  await mkdir(STORE_DIR, { recursive: true })
  await writeFile(STORE_FILE, JSON.stringify(posts, null, 2), 'utf8')
}

export async function listLocalPosts() {
  const posts = await readPosts()
  return posts
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 50)
}

export async function getLocalPost(id: string) {
  const posts = await readPosts()
  return posts.find((post) => post.id === id) ?? null
}

export async function insertLocalPost(input: {
  voice_profile_id: string
  post_type: PostType
  product_data_json: ProductData | null
  content_json: LocalContentJson | null
}) {
  const posts = await readPosts()
  const now = new Date().toISOString()
  const post: LocalPost = {
    id: `local_post_${randomUUID()}`,
    user_id: null,
    voice_profile_id: input.voice_profile_id,
    status: 'draft',
    post_type: input.post_type,
    publish_platform: null,
    product_data_json: input.product_data_json,
    content_json: input.content_json,
    body_text: null,
    match_score: null,
    score_detail_json: null,
    review_checklist_json: null,
    naver_post_url: null,
    published_url: null,
    created_at: now,
    updated_at: now,
  }
  posts.unshift(post)
  await writePosts(posts)
  return post
}

export async function updateLocalPost(id: string, patch: Partial<LocalPost> & { status?: PostStatus }) {
  const posts = await readPosts()
  const index = posts.findIndex((post) => post.id === id)
  if (index < 0) return null
  posts[index] = { ...posts[index], ...patch, updated_at: new Date().toISOString() }
  await writePosts(posts)
  return posts[index]
}
