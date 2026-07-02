// 발행 전 게이트 — publish 라우트의 로컬/DB 경로가 공유하는 순수 함수.
// 라우트 밖으로 분리한 이유: 게이트 규칙(D-012 채널 분리, D-022 말투 점수)을 단위 테스트로 잠그기 위함.

import { auditCommercePack, auditPlainPost } from './commerce-pack'
import type { AuditResult } from './commerce-pack'

export const VOICE_SCORE_PASS = 75

// D-012: 네이버는 비상업 후기 채널 — 쿠팡 링크 포함 글 발행 금지 (쿠팡 링크는 티스토리로)
const COUPANG_LINK_PATTERN = /coupang\.com|coupa\.ng/i

export interface PublishGateInput {
  post_type: string | null
  body_text: string | null
  match_score: number | null
  usage_basis?: string | null
  platform?: string | null
}

export type PublishGateResult =
  | { ok: true }
  | { ok: false; status: number; error: string; audit?: AuditResult }

export function checkPublishGate(input: PublishGateInput): PublishGateResult {
  if (!input.body_text) {
    return { ok: false, status: 400, error: '발행할 본문이 없습니다.' }
  }

  // 말투 점수 게이트 (D-022). 미채점(null)도 차단 — 재생성 후 점수가 리셋된 글이
  // 채점 없이 발행되는 우회를 막는다.
  if (input.match_score == null) {
    return {
      ok: false,
      status: 422,
      error: '말투 점수가 없습니다. 생성/재생성 후에는 채점을 먼저 통과해야 발행할 수 있습니다.',
    }
  }
  if (input.match_score < VOICE_SCORE_PASS) {
    return {
      ok: false,
      status: 422,
      error: `말투 점수가 ${VOICE_SCORE_PASS}점 미만입니다. AI티 위험이 있어 재생성 또는 수정 후 다시 채점하세요.`,
    }
  }

  // 채널 분리 게이트 (D-012)
  if (input.platform === 'naver' && COUPANG_LINK_PATTERN.test(input.body_text)) {
    return {
      ok: false,
      status: 422,
      error: '네이버 발행 본문에 쿠팡 링크가 있습니다. 네이버는 비상업 후기 채널입니다 — 링크를 제거하거나 티스토리로 발행하세요.',
    }
  }

  // 정책 감사 게이트 — commerce_pack은 섹션 감사, product는 평문 감사(기본 curation 기준)
  if (input.post_type === 'commerce_pack') {
    const audit = auditCommercePack(input.body_text, input.usage_basis ?? null)
    if (audit.overall === 'fail') {
      return { ok: false, status: 422, error: '정책 감사 fail 항목이 있어 발행할 수 없습니다.', audit }
    }
  } else if (input.post_type === 'product') {
    const audit = auditPlainPost(input.body_text, input.usage_basis ?? 'curation')
    if (audit.overall === 'fail') {
      return { ok: false, status: 422, error: '정책 감사 fail 항목이 있어 발행할 수 없습니다.', audit }
    }
  }

  return { ok: true }
}
