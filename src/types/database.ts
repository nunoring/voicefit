import type { ProfileJson, PostStatus, PostType, PublishPlatform, ScoreDetail, ReviewChecklist, ImageSourceType } from './index'

/**
 * Supabase 데이터베이스 타입 스켈레톤.
 * 실제 프로젝트 연결 후 `supabase gen types typescript --project-id <id> > src/types/database.ts`
 * 명령으로 교체하면 자동 생성된 완전한 타입을 얻을 수 있습니다.
 */
export interface Database {
  public: {
    Tables: {
      voice_profiles: {
        Row: {
          id: string
          user_id: string | null
          name: string
          source_text: string
          profile_json: ProfileJson
          reusable_system_prompt: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id?: string | null
          name: string
          source_text: string
          profile_json: ProfileJson
          reusable_system_prompt: string
          created_at?: string
          updated_at?: string
        }
        Update: Partial<Database['public']['Tables']['voice_profiles']['Insert']>
      }
      posts: {
        Row: {
          id: string
          user_id: string | null
          voice_profile_id: string | null
          status: PostStatus
          post_type: PostType | null
          publish_platform: PublishPlatform | null
          product_data_json: Record<string, unknown> | null
          content_json: Record<string, unknown> | null
          body_text: string | null
          match_score: number | null
          score_detail_json: ScoreDetail | null
          review_checklist_json: ReviewChecklist | null
          naver_post_url: string | null
          published_url: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id?: string | null
          voice_profile_id?: string | null
          status?: PostStatus
          post_type?: PostType | null
          publish_platform?: PublishPlatform | null
          product_data_json?: Record<string, unknown> | null
          content_json?: Record<string, unknown> | null
          body_text?: string | null
          match_score?: number | null
          score_detail_json?: ScoreDetail | null
          review_checklist_json?: ReviewChecklist | null
          naver_post_url?: string | null
          published_url?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: Partial<Database['public']['Tables']['posts']['Insert']>
      }
      post_images: {
        Row: {
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
        Insert: {
          id?: string
          post_id: string
          source_type: ImageSourceType
          storage_path: string
          public_url: string
          vision_interpretation?: string | null
          placement_index?: number | null
          generated_paragraph?: string | null
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['post_images']['Insert']>
      }
    }
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: Record<string, never>
  }
}
