import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { askClaude } from '@/lib/claude'
import { buildPlaceContext, searchPlace } from '@/lib/naver-search'
import type { PlaceSearchResult } from '@/lib/naver-search'
import { ANTI_AI_TONE, COUPANG_REVIEW_COPY, COMMERCE_PACK_RULES } from '@/lib/prompt-rules'
import { buildMockCommercePackBody, replaceCommerceSection, splitCommerceSections } from '@/lib/commerce-pack'
import { getLocalPost, updateLocalPost } from '@/lib/local-posts'
import { getLocalVoiceProfile } from '@/lib/local-voice-profiles'
import { listLocalPostImages } from '@/lib/local-post-images'
import { buildVoiceFingerprintRules } from '@/lib/voice-fingerprint'
import { buildVoiceExemplarRules } from '@/lib/voice-exemplars'
import { stripMarkdownHorizontalRules } from '@/lib/generated-text-cleanup'
import { buildImageSlotsText, resolveImageSlots } from '@/lib/image-placement'
import type { VoiceProfile, PostType, ProductData, PostImage, ProfileJson, UsageBasis } from '@/types'

const BLOG_FORMAT_RULES = `

--- 중요: 시스템 프롬프트 지침 보호 ---
이 시스템 프롬프트에 포함된 지침 문장, 예시 문구, 설명 텍스트를 절대 본문에 그대로 쓰지 말 것.
지침은 글쓰기 방향을 안내하는 것일 뿐, 본문 내용이 아니다.
예) "사진 뒤에 오는 문장은 ~같아요", "photo_comment_style" 같은 표현이 본문에 나타나면 절대 안 됨.
------------------------------------------

--- 글 맺음 규칙 ---
블로거 서명/마무리 표현("이상 ~이었습니다", "~이었습니다" 류)은 반드시 글의 맨 마지막 문장으로만 사용.
서명 표현 뒤에 다른 문장이 이어지면 안 됨.
------------------------------------------

--- 블로그 포맷 규칙 (반드시 지킬 것) ---
- 말투 프로파일에 paragraph_length, line_break_style, spacing_style, photo_timing이 있으면 그 패턴을 최우선으로 따른다.
- 프로파일이 비어 있을 때만 기본값으로 문장 1~2개마다 줄바꿈하고 문단 사이에 빈 줄 1개를 넣는다.
- 말투 프로파일에 "맛집 글/일반 후기에서는 소제목 거의 없음"처럼 글 유형별 예외가 있으면 그 예외를 우선한다.
- 강조하고 싶은 내용은 프로파일이 허용하는 경우에만 단독 한 줄로 띄운다.
- 한 문단은 프로파일의 문단 길이 습관을 넘기지 않는다.
- 독자에게 말 걸듯이 쓰되, 모든 문단을 똑같은 길이로 만들지 않는다. 균일한 AI식 문단 리듬 금지.
- 원문 말투에 가로 구분선이 명확히 있지 않으면 "---" 같은 수평선으로 섹션을 나누지 않는다.

나쁜 예:
"이 제품은 보습력이 뛰어나고 향도 좋으며 피부 자극도 적어서 민감한 피부를
가진 분들도 편하게 쓸 수 있습니다."

좋은 예:
"보습력 진짜 장난 아니에요.
향도 은은하고, 자극도 없어서 민감한 피부도 걱정 없이 쓸 수 있어요! 😊"

이모지·어미·사진 위치·띄어쓰기·줄넘김은 말투 프로파일을 따른다.
------------------------------------------ 

--- 톤 가드레일 ---
이 글은 개인 블로그 포스팅이다. 광고·홍보물도 아니고, 혹평 리뷰도 아니다.
전체적으로 **긍정적이되 솔직한 톤**을 유지할 것.

금지 표현:
- "지금 바로 구매하세요", "한정 수량", "강력 추천", "무조건"
- 과도한 부정: 아쉬운 점은 1개 정도면 충분. 전체 절반 이상을 단점으로 채우지 말 것
- "이 제품이", "제품명", "구매" 등 상품 리뷰 전용 표현 (음식점/경험 글에서)

반드시 지킬 것:
- 경험한 것 위주로 써서 읽는 사람이 공감할 수 있게
- 아쉬운 점이 있어도 전체 분위기는 "그래도 괜찮았다" 방향으로 마무리
- 마무리는 재방문 의향이나 추천 여부로 자연스럽게
------------------------------------------`

const VOICE_FIRST_BLOG_RULES = `

--- 말투 우선 블로그 규칙 ---
목표는 "잘 정돈된 글"보다 "이 사람이 직접 쓴 것 같은 글"이다.
- # 제목 1개만 사용하고, 본문은 메모 순서대로 자연스럽게 흐르게 쓴다.
- 후킹·SEO·정형 구조보다 말버릇, 줄넘김, 붙여쓰기, 문장부호, ㅋㅋ/ㅎㅎ 타이밍을 우선한다.
- 말투 프로파일이 해당 장르에서 소제목을 거의 안 쓴다고 하면 ## 소제목과 "---" 구분선을 쓰지 않는다.
- 정보 헤더나 지도 링크가 붙어도 본문은 정보 문서처럼 정리하지 않는다.
------------------------------------------`

const STYLE_TRANSFER_RULES = `

--- 2차 말투 복제 패스 ---
아래 초안의 사실·순서·장소/상품 정보는 유지하되, 말투만 원문 샘플처럼 다시 입힌다.
목표는 교정된 글이 아니라 원문 글쓴이가 직접 쓴 것 같은 표면 습관 복제다.
- 문장 일부를 일부러 짧게 끊고, 문단 길이를 들쭉날쭉하게 만든다.
- 원문처럼 붙여쓰기/줄넘김/괄호/ㅋㅋ/ㅎㅎ/!!/?? 타이밍을 살린다.
- 원문 프로필이 이모티콘을 쓰면 글 전체에 1개는 자연스럽게 넣는다. 단 문단마다 넣지 않는다.
- 원문 프로필이 ㅋㅋㅋㅋ, ㅎㅎ, !!, ??를 쓰면 최소 1개는 실제 말투처럼 살린다.
- 시그니처 표현은 1~3개만 자연스럽게 섞는다. 과하면 AI티로 본다.
- 정형 소제목, "---" 구분선, 요약형 마무리, 지나치게 깔끔한 정보문 톤은 제거한다.
- "이런 분께 추천", "가격 확인하기", "보러 가기" 같은 정형 광고 문구를 새로 만들지 않는다.
- 정보 설명 문장이 3문단 이상 연속되지 않게, 중간에 짧은 감정 문장이나 혼잣말 문장을 섞는다.
- 초안에 없는 새로운 사실, 가격, 메뉴, 효능, 방문 경험은 추가하지 않는다.
------------------------------------------`

const PRODUCT_FACT_DRAFT_RULES = `

--- 상품 정보 초안 규칙 ---
이 단계는 판매 카피가 아니라 개인 블로그에 넣을 상품 정보 초안이다.
- commerce_pack에서는 ## 블로그 글 섹션에만 이 규칙을 엄격 적용하고, 쇼츠/CTA/고지 섹션은 각 섹션 규칙을 따른다.
- 말투 지문이 카피 규칙보다 우선이다. 충돌하면 말투 지문을 따른다.
- "이런 분께 추천", "가격 확인하기", "보러 가기", "한 번 확인해보세요" 같은 정형 CTA 금지.
- 불편을 과하게 부풀려 문제 제기하지 말고, 상품 정보에서 확인되는 특징만 담백하게 정리한다.
- 직접 사용하지 않은 상품은 효과 확정·해결 확정·사용 후기처럼 쓰지 않는다.
- "정보를 찾아보니", "스펙을 보면", "상세 정보 기준" 같은 간접 출처 표현은 글 전체 1~2회만 쓴다.
- 나머지는 "내 책상에 두면", "이런 부분은 괜찮아 보였고", "이 점이 눈에 들어왔어요"처럼 관찰+생각 톤으로 푼다.
- 링크가 필요하면 마지막에 상품명 링크 한 줄만 둔다. 구매를 재촉하지 않는다.
------------------------------------------`

const ANTI_HALLUCINATION = `
--- 절대 지켜야 할 사실 원칙 ---
최우선: 사용자가 직접 쓴 경험 메모만이 사실의 근거다.
네이버 검색 결과는 보조 참고용일 뿐이며, 메모 내용과 충돌하면 메모를 따른다.

금지 사항:
- 메모에 없는 구체적 사실 지어내기 금지 (메뉴, 가격, 인테리어, 직원, 효능 등)
- 장소 이름만 보고 장르/업종을 멋대로 판단 금지
  예) "목구멍"이라는 이름을 보고 목건강 클리닉이라고 단정하지 말 것 — 고기집일 수 있음
- 검색 결과가 메모와 다르면 메모 우선. 검색 결과는 "~로 알려져 있어요" 톤으로만
- 쿠팡 파트너스, 구매 링크, 상품 구매 유도 문구 금지
- "이 제품이", "이 제품을", "제품명", "구매하다", "구매 링크" 등 상품 리뷰 전용 표현 금지
  → 음식점/경험 리뷰라면 "이 집이", "여기가", "이 곳이" 등으로 표현할 것
- 사진에 보이는 것을 메모·사실 근거 없이 '먹었다/했다/경험했다'로 단정하지 말 것.
------------------------------------------`

// 구조 가이드 (heading_usage 기반 조건부)
function buildStructureGuide(headingUsage?: string): string {
  const forbidsReviewHeadings = headingUsage
    && /(맛집|후기|일반 후기)[^.\n]*(소제목 거의 없음|소제목을? 거의 안|흘러가듯)/.test(headingUsage)
  const useHeadings = !forbidsReviewHeadings && headingUsage && /자주|H2|소제목.*자주/.test(headingUsage)
  if (useHeadings) {
    return `
글 구조 (소제목 포함):
1. # 제목 (지역명/업체명 + 핵심 특징)
2. 도입부: 방문 계기, 첫인상
3. ## 매장 분위기: 위치, 인테리어, 접근성
4. ## 음식 리뷰: 맛, 식감, 비주얼
5. ## 이 집만의 포인트
6. 마무리: 총평, 재방문 의사`
  }
  return `
글 흐름:
- # 제목 1개 뒤에 방문 계기, 첫인상, 먹거나 본 것, 아쉬운 점, 마무리를 메모 순서대로 자연스럽게 연결
- ## 매장 분위기, ## 음식 리뷰 같은 정형 소제목 금지
- --- 같은 가로 구분선 금지
- 정보 문서처럼 나누지 말고 실제 후기처럼 흐름대로 짧게 끊어 쓸 것`
}

function buildSystemPrompt(postType: PostType, reusableSystemPrompt: string, voiceFingerprint: string, voiceExemplars = ''): string {
  const voiceBase = reusableSystemPrompt + voiceFingerprint + voiceExemplars
  if (postType === 'coupang') {
    return voiceBase + ANTI_AI_TONE + COUPANG_REVIEW_COPY
  }
  if (postType === 'daily' || postType === 'review') {
    return voiceBase + VOICE_FIRST_BLOG_RULES + ANTI_AI_TONE
  }
  if (postType === 'product') {
    return voiceBase + BLOG_FORMAT_RULES + PRODUCT_FACT_DRAFT_RULES + ANTI_AI_TONE
  }
  if (postType === 'commerce_pack') {
    return voiceBase + BLOG_FORMAT_RULES + PRODUCT_FACT_DRAFT_RULES + ANTI_AI_TONE + COMMERCE_PACK_RULES
  }
  return voiceBase + BLOG_FORMAT_RULES + ANTI_AI_TONE
}

function buildStyleTransferSystemPrompt(
  postType: PostType,
  reusableSystemPrompt: string,
  voiceFingerprint: string,
  voiceExemplars = '',
): string {
  const voiceBase = reusableSystemPrompt + voiceFingerprint + voiceExemplars
  const voiceFirst = postType === 'daily' || postType === 'review' ? VOICE_FIRST_BLOG_RULES : BLOG_FORMAT_RULES + PRODUCT_FACT_DRAFT_RULES
  return voiceBase + voiceFirst + STYLE_TRANSFER_RULES + ANTI_AI_TONE
}

function shouldRunFullStyleTransfer(postType: PostType): boolean {
  return postType === 'daily' || postType === 'review' || postType === 'product'
}

function buildStyleTransferPrompt(draft: string, usageBasis?: UsageBasis): string {
  return `아래 초안을 사실은 유지하고 말투만 다시 입혀라.

${usageBasis ? usageBasisInstruction(usageBasis) : ''}

## 초안
${draft}

## 출력
- 마크다운 본문만 출력
- 설명/분석/수정 내역 쓰지 말 것
- # 제목 1개를 반드시 포함. 제목 없이 본문으로 바로 시작하지 말 것
- 본문은 원문 샘플의 줄넘김·붙여쓰기·이모티콘·ㅋㅋ/ㅎㅎ·문장부호 습관을 최대한 복제`
}

async function applyStyleTransfer(
  rawText: string,
  postType: PostType,
  styleTransferSystemPrompt: string,
  usageBasis?: UsageBasis,
): Promise<string> {
  if (shouldRunFullStyleTransfer(postType)) {
    return askClaude({
      system: styleTransferSystemPrompt,
      user: buildStyleTransferPrompt(rawText, usageBasis),
    })
  }

  if (postType !== 'commerce_pack') return rawText

  const blogDraft = splitCommerceSections(rawText)['블로그 글']
  if (!blogDraft) return rawText

  const styledBlog = await askClaude({
    system: styleTransferSystemPrompt,
    user: buildStyleTransferPrompt(blogDraft, usageBasis),
  })
  return replaceCommerceSection(rawText, '블로그 글', styledBlog)
}

function buildDailyPrompt(dailyContent: string, images: PostImage[]): string {
  return `## 오늘의 일상 메모
${dailyContent}

## 사진
${buildImageSlotsText(images)}

## 요구사항
- 마크다운 형식, 최소 600자
- 메모를 그대로 옮기지 말고 독자에게 말 걸듯 풀어낼 것
- # 제목 포함
- 광고나 홍보 문구 절대 금지
${ANTI_HALLUCINATION}`
}

function buildReviewPrompt(
  place: string,
  experience: string,
  placeContext = '',
  images: PostImage[] = [],
  headingUsage?: string,
  placeLink?: string,
): string {
  const structure = buildStructureGuide(headingUsage)
  const imageSection = buildImageSlotsText(images)
  const linkSection = placeLink ? `\n\n마무리 끝에 다음 줄 추가:\n📍 네이버 플레이스: ${placeLink}` : ''

  return `## 방문한 장소
${place}

## 내 경험 메모 (최우선 — 이게 글의 핵심)
${experience}${placeContext}

## 사진
${imageSection}
${structure}

## 요구사항
- 마크다운 형식, 최소 700자
- 직접 방문한 생생한 후기 톤
- 좋았던 점 위주, 아쉬운 점 1개 정도만
- 검색 정보는 "~로 알려져 있어요" 톤으로만
- 과장 표현 금지${linkSection}
${ANTI_HALLUCINATION}`
}

function buildUserPrompt(product: ProductData, images: PostImage[], usageBasis: UsageBasis): string {
  const itemsText = product.items
    .map(
      (item, i) =>
        `상품 ${i + 1}:\n  이름: ${item.name}${item.price ? `\n  가격: ${item.price.toLocaleString()}원` : ''}${item.url ? `\n  URL: ${item.url}` : ''}${item.description ? `\n  설명: ${item.description}` : ''}`,
    )
    .join('\n\n')

  return `## 상품 정보\n${itemsText}

## 사진
${buildImageSlotsText(images)}

${usageBasisInstruction(usageBasis)}

## 요구사항
- 마크다운 형식, 최소 800자
- 상품 특징과 장점을 독자 시점에서 자연스럽게 녹여낼 것
- 광고문처럼 보이는 정형 소제목, 추천 리스트, 구매 재촉 문구 금지
- 마지막에는 상품 링크를 담백하게 한 줄만 둘 것`
}

// 직접 사용 여부에 따라 1인칭 후기 표현 허용/차단을 명시 — 안 써본 상품을 "직접 써보니"로 포장하는 것 방지.
function usageBasisInstruction(usageBasis: UsageBasis): string {
  if (usageBasis === 'used') {
    return `## 사용 여부
작성자가 이 상품을 직접 사용해봤다. "직접 써보니", "써본 결과" 같은 1인칭 사용 경험 표현을 써도 된다.
단 위 상품 정보·사진 설명에 없는 사용 디테일은 지어내지 말 것.`
  }
  return `## 사용 여부
작성자가 이 상품을 직접 사용해보지 않았다 (정보성 큐레이션).
"직접 써보니", "써본 결과", "써봤는데" 같은 1인칭 사용 후기 표현을 절대 쓰지 말 것.
대신 "정보를 찾아보니", "스펙을 보면", "상세 정보를 기준으로 보면" 같은 정보 제공자 시점으로 쓸 것.
단 "이런 분들께 추천" 같은 정형 광고 섹션은 만들지 말 것.
간접 출처 표현은 반복하지 말고, 관찰한 정보에 대한 내 생각을 자연스럽게 섞을 것.`
}

// 커머스 콘텐츠 패키지 — 상품 정보 1회 입력으로 블로그+쇼츠+제작지시+캡션+CTA+고지+가설+체크리스트까지 한 번에.
function buildCommercePackPrompt(product: ProductData, images: PostImage[], usageBasis: UsageBasis): string {
  const itemsText = product.items
    .map(
      (item, i) =>
        `상품 ${i + 1}:\n  이름: ${item.name}${item.price ? `\n  가격: ${item.price.toLocaleString()}원` : ''}${item.url ? `\n  URL: ${item.url}` : ''}${item.description ? `\n  설명: ${item.description}` : ''}`,
    )
    .join('\n\n')

  return `## 상품 정보\n${itemsText}

## 사진
${buildImageSlotsText(images)}

${usageBasisInstruction(usageBasis)}

## 요구사항
- 마크다운 형식. COMMERCE_PACK_RULES에 정의된 9개 섹션을 모두, 그 순서·제목 그대로 작성 (생략 금지)
- "블로그 글" 섹션만 최소 600자. 나머지 섹션은 각자 분량 가이드대로 짧고 실용적으로
- 상품 정보·사진 설명에 없는 효능·가격·수익은 절대 지어내지 말 것
${ANTI_HALLUCINATION}`
}

// 쿠팡 상품평(체험단) — 블로그 아님. 평문·길게·사진 전부 활용·링크 없음.
function buildCoupangPrompt(product: string, experience: string, images: PostImage[]): string {
  const imageSection = images.length
    ? `## 함께 올릴 사진 (${images.length}장 — 쿠팡 앱에 따로 업로드함)
다음 사진들의 내용(색감·마감·크기·구성 등)을 글에서 자연스럽게 녹여 후기를 풍부하게 만든다.
단 이미지 placeholder나 <사진N> 같은 표시는 절대 넣지 말 것 — 사진은 쿠팡에 별도 업로드하고 본문엔 글만 들어간다.
${images
  .map((img, i) => {
    const d = img.vision_interpretation ? img.vision_interpretation.split(/[.。]/)[0].trim() : `사진 ${i + 1}`
    return `- ${d}`
  })
  .join('\n')}`
    : '## 사진\n없음.'

  return `## 상품
${product}

## 내 사용 경험 메모 (글의 핵심 — 여기 적힌 것만 사실)
${experience}

${imageSection}

## 요구사항
- 쿠팡 상품페이지에 올리는 '상품평'이다. 블로그 글이 아니다.
- 제목·소제목(#) 없이 평문으로. 블로거 서명("이상 ~이었습니다" 류) 금지.
- 길고 구체적으로 (1000자 이상 목표). 단 메모에 없는 사실을 지어내거나 같은 말을 반복해 늘리지 말 것 — 사진별 관찰과 메모 디테일로 분량을 채운다.
- 실제 사용 느낌·장점·아쉬운 점·추천 대상을 구체적으로. '도움되는' 후기가 쿠팡 베스트순에 유리하다.
- 외부 링크·구매 유도 문구 금지 (쿠팡 안에서 쓰는 글이라 링크 불필요).
${ANTI_HALLUCINATION}`
}

// 가게리뷰 본문 맨 위 정보 헤더 — 주소·전화·지도 같은 '사실'은 코드가 직접 조립한다.
// LLM에 맡기면 전화번호·주소를 지어낼 수 있어(할루시네이션) 금지. (✅-15/❌-17 원칙)
function buildPlaceInfoHeader(place: PlaceSearchResult, placeLink?: string): string {
  const d = place.detail
  const b = place.basicInfo
  const strip = (s?: string) => (s ? s.replace(/<[^>]+>/g, '').trim() : '')

  const name = d?.name || strip(b?.title)
  const category = d?.category || b?.category || ''
  const address = d?.address || b?.roadAddress || b?.address || ''
  const phone = d?.phone || b?.telephone || ''
  const hours = d?.bizhourInfo || ''
  const star = d?.starScore

  // 신뢰할 기본정보가 없으면 헤더 생략(잘못된 정보 노출 방지)
  if (!name && !address) return ''

  const headline = [name && `**${name}**`, category].filter(Boolean).join(' · ')
  const lines: string[] = []
  if (headline) lines.push(star ? `${headline} · ⭐ ${star}` : headline)
  if (address) lines.push(`📍 ${address}`)
  if (phone) lines.push(`☎️ ${phone}`)
  if (hours) lines.push(`🕒 ${hours}`)
  // placeId 없어도 가게명으로 지도 검색 링크 폴백 — 지도 링크는 항상 노출
  const mapLink = placeLink || (name ? `https://map.naver.com/p/search/${encodeURIComponent(name)}` : '')
  if (mapLink) lines.push(`🗺️ [네이버 지도에서 보기](${mapLink})`)

  return lines.join('\n')
}

// 헤더(+대문사진)를 본문 맨 위에 붙인다. 대문사진은 본문 인라인에서 1회 제거(중복 방지).
function prependPlaceInfo(header: string, body: string, hasImages: boolean): string {
  if (!header) return body
  let cover = ''
  let main = body
  if (hasImages) {
    cover = '![image-1]\n\n'
    main = main.replace(/!\[image-1\]\s*\n*/, '') // 첫 인라인 1회만 제거
  }
  return `${cover}${header}\n\n${main}`
}

export async function POST(
  _req: NextRequest,
  ctx: RouteContext<'/api/posts/[id]/generate'>,
) {
  try {
    const { id } = await ctx.params
    if (id.startsWith('local_post_')) {
      const localPost = await getLocalPost(id)
      if (!localPost) throw new Error('로컬 글을 찾을 수 없습니다.')
      const localProfile = localPost.voice_profile_id
        ? await getLocalVoiceProfile(localPost.voice_profile_id)
        : null
      if (!localProfile) throw new Error('로컬 말투 프로필을 찾을 수 없습니다.')

      const postType = localPost.post_type ?? 'product'
      const localImages = await listLocalPostImages(id)
      let userPrompt: string
      let placeInfoHeader = ''
      let mockRawText: string | null = null

      if (postType === 'daily') {
        const dailyContent = localPost.content_json?.daily_content ?? ''
        if (!dailyContent.trim()) throw new Error('일상 기록 내용이 없습니다.')
        userPrompt = buildDailyPrompt(dailyContent, localImages)

      } else if (postType === 'review') {
        const place = localPost.content_json?.review_place ?? ''
        const experience = localPost.content_json?.review_experience ?? ''
        if (!place.trim()) throw new Error('장소 정보가 없습니다.')

        const placeResult = await searchPlace(place)
        const placeContext = await buildPlaceContext(place)
        const placeLink = placeResult.placeId
          ? `https://m.place.naver.com/place/${placeResult.placeId}`
          : undefined

        placeInfoHeader = buildPlaceInfoHeader(placeResult, placeLink)
        userPrompt = buildReviewPrompt(
          place,
          experience,
          placeContext,
          localImages,
          localProfile.profile_json?.heading_usage,
          placeLink,
        )

      } else if (postType === 'coupang') {
        const product = localPost.content_json?.coupang_product ?? ''
        const experience = localPost.content_json?.coupang_experience ?? ''
        if (!product.trim()) throw new Error('상품명이 없습니다.')
        userPrompt = buildCoupangPrompt(product, experience, localImages)

      } else if (postType === 'commerce_pack') {
        if (!localPost.product_data_json?.items?.length) {
          throw new Error('상품 데이터가 없습니다.')
        }
        const usageBasis = localPost.content_json?.usage_basis ?? 'curation'
        if (process.env.COMMERCE_PACK_MOCK === '1') {
          mockRawText = buildMockCommercePackBody(localPost.product_data_json, usageBasis)
          userPrompt = ''
        } else {
          userPrompt = buildCommercePackPrompt(localPost.product_data_json, localImages, usageBasis)
        }

      } else {
        if (!localPost.product_data_json?.items?.length) {
          throw new Error('상품 데이터가 없습니다.')
        }
        // product 홍보글도 사용 여부 지침 적용 — 안 써본 상품의 "직접 써보니" 생성 방지 (기본 curation)
        userPrompt = buildUserPrompt(localPost.product_data_json, localImages, localPost.content_json?.usage_basis ?? 'curation')
      }

      const voiceFingerprint = buildVoiceFingerprintRules(localProfile.profile_json)
      const voiceExemplars = buildVoiceExemplarRules(localProfile.source_text, localProfile.profile_json, { postType })
      const systemPrompt = buildSystemPrompt(postType, localProfile.reusable_system_prompt, voiceFingerprint, voiceExemplars)
      const styleTransferSystemPrompt = buildStyleTransferSystemPrompt(postType, localProfile.reusable_system_prompt, voiceFingerprint, voiceExemplars)

      let rawText = mockRawText ?? await askClaude({
        system: systemPrompt,
        user: userPrompt,
      })
      if (!mockRawText) {
        rawText = await applyStyleTransfer(rawText, postType, styleTransferSystemPrompt, localPost.content_json?.usage_basis)
      }
      if (postType !== 'commerce_pack') rawText = stripMarkdownHorizontalRules(rawText)
      let body_text = postType === 'coupang' ? rawText : resolveImageSlots(rawText, localImages)
      if (placeInfoHeader) {
        body_text = prependPlaceInfo(placeInfoHeader, body_text, localImages.length > 0)
      }
      await updateLocalPost(id, { body_text, status: 'scored' })
      return NextResponse.json({ body_text, status: 'scored' })
    }

    const supabase = createServerClient()

    const { data: post, error: postErr } = await supabase
      .from('posts')
      .select('*, voice_profiles(reusable_system_prompt, profile_json, source_text)')
      .eq('id', id)
      .single()

    if (postErr) throw new Error(postErr.message)

    const row = post as unknown as {
      post_type: PostType | null
      product_data_json: ProductData | null
      content_json: { daily_content?: string; review_place?: string; review_experience?: string; coupang_product?: string; coupang_experience?: string; usage_basis?: UsageBasis } | null
      voice_profiles: Pick<VoiceProfile, 'reusable_system_prompt' | 'profile_json' | 'source_text'> | null
    }
    const profileJson = row.voice_profiles?.profile_json as ProfileJson | undefined

    if (!row.voice_profiles) throw new Error('연결된 보이스 프로파일이 없습니다.')

    const postType = row.post_type ?? 'product'

    await supabase.from('posts').update({ status: 'generating' }).eq('id', id)

    // 이미지 조회 헬퍼
    async function queryImages(): Promise<PostImage[]> {
      const { data } = await supabase
        .from('post_images').select('*').eq('post_id', id)
        .order('placement_index', { ascending: true })
        .order('created_at', { ascending: true })
      return (data ?? []) as unknown as PostImage[]
    }

    const finalImages = await queryImages()
    let userPrompt: string
    let placeInfoHeader = '' // 가게리뷰일 때만 채워짐
    // COMMERCE_PACK_MOCK=1: 실 Claude 호출 없이 deterministic 더미 본문 사용 (commerce_pack 전용, UI/감사/복사 테스트용)
    let mockRawText: string | null = null

    if (postType === 'daily') {
      const dailyContent = row.content_json?.daily_content ?? ''
      if (!dailyContent.trim()) throw new Error('일상 기록 내용이 없습니다.')
      userPrompt = buildDailyPrompt(dailyContent, finalImages)

    } else if (postType === 'review') {
      const place = row.content_json?.review_place ?? ''
      const experience = row.content_json?.review_experience ?? ''
      if (!place.trim()) throw new Error('장소 정보가 없습니다.')

      // 플레이스 검색
      const placeResult = await searchPlace(place)

      // 이미지: 사용자가 직접 올린 사진만 사용한다.
      // 자동 소싱(네이버 방문자사진·이미지검색) 제거 — 제3자 저작권·약관 위반 리스크.
      // 업로드 사진의 vision 코멘트는 images/interpret 경로에서 처리됨.

      // 플레이스 컨텍스트 + 링크
      const placeContext = await buildPlaceContext(place)
      const placeLink = placeResult.placeId
        ? `https://m.place.naver.com/place/${placeResult.placeId}`
        : undefined

      // 본문 맨 위 정보 헤더(주소·전화·지도·대문사진) — 가게리뷰 한정
      placeInfoHeader = buildPlaceInfoHeader(placeResult, placeLink)

      userPrompt = buildReviewPrompt(
        place, experience, placeContext, finalImages,
        profileJson?.heading_usage, placeLink,
      )

    } else if (postType === 'coupang') {
      const product = row.content_json?.coupang_product ?? ''
      const experience = row.content_json?.coupang_experience ?? ''
      if (!product.trim()) throw new Error('상품명이 없습니다.')
      userPrompt = buildCoupangPrompt(product, experience, finalImages)

    } else if (postType === 'commerce_pack') {
      if (!row.product_data_json?.items?.length) throw new Error('상품 데이터가 없습니다.')
      const usageBasis = row.content_json?.usage_basis ?? 'curation'
      if (process.env.COMMERCE_PACK_MOCK === '1') {
        mockRawText = buildMockCommercePackBody(row.product_data_json, usageBasis)
        userPrompt = ''
      } else {
        userPrompt = buildCommercePackPrompt(row.product_data_json, finalImages, usageBasis)
      }

    } else {
      if (!row.product_data_json?.items?.length) throw new Error('상품 데이터가 없습니다.')
      // product 홍보글도 사용 여부 지침 적용 — 안 써본 상품의 "직접 써보니" 생성 방지 (기본 curation)
      userPrompt = buildUserPrompt(row.product_data_json, finalImages, row.content_json?.usage_basis ?? 'curation')
    }

    // 쿠팡 상품평은 블로그 서식·제목 룰 제외(평문·제목없음). 그 외엔 블로그 규칙 + 상품글·커머스패키지엔 큐레이션 카피.
    const voiceFingerprint = buildVoiceFingerprintRules(profileJson)
    const voiceExemplars = buildVoiceExemplarRules(row.voice_profiles.source_text, profileJson, { postType })
    const systemPrompt = buildSystemPrompt(postType, row.voice_profiles.reusable_system_prompt, voiceFingerprint, voiceExemplars)
    const styleTransferSystemPrompt = buildStyleTransferSystemPrompt(postType, row.voice_profiles.reusable_system_prompt, voiceFingerprint, voiceExemplars)
    let rawText = mockRawText ?? await askClaude({
      system: systemPrompt,
      user: userPrompt,
    })
    if (!mockRawText) {
      rawText = await applyStyleTransfer(rawText, postType, styleTransferSystemPrompt, row.content_json?.usage_basis)
    }
    if (postType !== 'commerce_pack') rawText = stripMarkdownHorizontalRules(rawText)
    // AI가 삽입한 <사진N_타입> 슬롯 → ![image-N] 변환
    // 쿠팡 상품평은 이미지 placeholder를 안 씀(사진은 쿠팡 앱에 따로 업로드) → 슬롯 변환 건너뜀
    let body_text = postType === 'coupang' ? rawText : resolveImageSlots(rawText, finalImages)
    // 가게리뷰: 네이버 플레이스 정보(주소·전화·지도) + 대문사진을 맨 위에 코드로 조립
    if (placeInfoHeader) {
      body_text = prependPlaceInfo(placeInfoHeader, body_text, finalImages.length > 0)
    }

    const { error: updateErr } = await supabase
      .from('posts')
      .update({ body_text, status: 'scored' })
      .eq('id', id)

    if (updateErr) throw new Error(updateErr.message)

    return NextResponse.json({ body_text, status: 'scored' })
  } catch (err) {
    const message = err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
