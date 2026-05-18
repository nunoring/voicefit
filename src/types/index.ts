// ── Screen navigation ─────────────────────────────────────────────────────────

export type Screen = 'onboarding' | 'generate' | 'review'

// ── voice_profiles ────────────────────────────────────────────────────────────

export interface ProfileJson {
  tone: string
  formality: string
  avg_sentence_length: number
  sentence_endings: string[]
  signature_phrases: string[]
  emoji_usage: string
  vocabulary_notes: string
  do_list: string[]
  dont_list: string[]
}

export interface VoiceProfile {
  id: string
  user_id: string | null
  name: string
  source_text: string
  profile_json: ProfileJson
  reusable_system_prompt: string
  created_at: string
  updated_at: string
}

// ── products ──────────────────────────────────────────────────────────────────

export interface ProductItem {
  name: string
  price?: number
  url?: string
  image_url?: string
  description?: string
}

export interface ProductData {
  source: 'manual' | 'coupang' | 'oliveyoung'
  items: ProductItem[]
}

// ── posts ─────────────────────────────────────────────────────────────────────

export type PostStatus = 'draft' | 'generating' | 'scored' | 'reviewing' | 'published'

export interface Highlight {
  text: string
  span?: [number, number]
  issue_type: 'tone' | 'formality' | 'phrasing' | 'emoji'
  suggestion: string
}

/** score_detail_json 에 저장되는 구조 */
export interface ScoreDetail {
  highlights: Highlight[]
  diagnosis: string
}

/** /api/posts/:id/score 가 Claude에서 받아 반환하는 구조 */
export interface ScoreApiResult {
  match_score: number
  highlights: Highlight[]
  diagnosis: string
}

export interface ReviewChecklist {
  all_passed: boolean
  items: ChecklistItem[]
}

export interface ChecklistItem {
  id: string
  label: string
  checked: boolean
  category: 'content' | 'seo' | 'compliance' | 'image'
}

export interface Post {
  id: string
  user_id: string | null
  voice_profile_id: string | null
  status: PostStatus
  product_data_json: ProductData | null
  body_text: string | null
  match_score: number | null
  score_detail_json: ScoreDetail | null
  review_checklist_json: ReviewChecklist | null
  naver_post_url: string | null
  created_at: string
  updated_at: string
}

// ── post_images ───────────────────────────────────────────────────────────────

export type ImageSourceType = 'official' | 'stock' | 'user_uploaded'

export interface PostImage {
  id: string
  post_id: string
  source_type: ImageSourceType
  storage_path: string
  public_url: string
  vision_interpretation: string | null
  placement_index: number | null
  generated_paragraph: string | null
  created_at: string
}

// ── API response shapes ───────────────────────────────────────────────────────

export interface VoiceProfileCreateResponse {
  id: string
  profile_json: ProfileJson
  reusable_system_prompt: string
}

export interface PostCreateResponse {
  id: string
  status: PostStatus
}

export interface GenerateResponse {
  body_text: string
  status: PostStatus
}

export interface FetchProductsResponse {
  items: ProductItem[]
  fallback?: boolean
}

export interface PublishApiResult {
  published: boolean
  naver_post_url?: string
  html?: string
  markdown?: string
  status: PostStatus
}
