/**
 * 말투 프로필 지문 테스트 — AI티 방지용 세부 필드 정규화/프롬프트 생성 검증.
 * 실행: npx tsx scripts/test-voice-profile.ts
 */

import { normalizeProfileJson } from '../src/app/api/voice-profiles/route'
import { buildVoiceFingerprintRules } from '../src/lib/voice-fingerprint'
import { buildVoiceExemplarRules, extractVoiceExcerpts } from '../src/lib/voice-exemplars'
import { stripMarkdownHorizontalRules } from '../src/lib/generated-text-cleanup'

let passed = 0
let failed = 0

function test(name: string, fn: () => void): void {
  try {
    fn()
    console.log(`  ✅ ${name}`)
    passed++
  } catch (e) {
    console.log(`  ❌ ${name}: ${e instanceof Error ? e.message : String(e)}`)
    failed++
  }
}

function assert(condition: boolean, msg: string): void {
  if (!condition) throw new Error(msg)
}

console.log('\n[1] normalizeProfileJson')

test('새 말투 지문 필드를 보존', () => {
  const profile = normalizeProfileJson({
    tone: '담백한 후기 톤',
    formality: '반말 섞인 존댓말',
    avg_sentence_length: 17,
    sentence_endings: ['~더라고요', '~했어요'],
    signature_phrases: ['개인적으로'],
    emoji_usage: '가끔',
    emoji_position: '문단 끝',
    emoji_timing: '음식 사진 감탄 뒤',
    photo_timing: '소제목 직후',
    paragraph_length: '1~2줄',
    spacing_style: '블로그식 띄어쓰기',
    line_break_style: '문장마다 줄바꿈',
    heading_usage: '가끔 씀',
    photo_comment_style: '사진 뒤 짧은 한마디',
    punctuation_style: 'ㅋㅋ는 적게',
    vocabulary_notes: '구체적인 감상어',
    ai_tell_risks: ['균일한 문단', '광고 CTA'],
    do_list: ['짧게 끊기'],
    dont_list: ['과장 금지'],
  })

  assert(profile.emoji_timing === '음식 사진 감탄 뒤', 'emoji_timing 누락')
  assert(profile.line_break_style === '문장마다 줄바꿈', 'line_break_style 누락')
  assert(profile.punctuation_style === 'ㅋㅋ는 적게', 'punctuation_style 누락')
  assert(profile.ai_tell_risks?.length === 2, 'ai_tell_risks 누락')
})

test('객체가 와도 문자열로 안전하게 펼침', () => {
  const profile = normalizeProfileJson({
    tone: { base: '담백함', speed: '빠름' },
    emoji_usage: { frequency: 'low' },
    line_break_style: { rule: '문장마다', blank: '사진 전후' },
    ai_tell_risks: [{ risk: '균일한 문단' }],
  })

  assert(profile.tone.includes('base: 담백함'), `tone=${profile.tone}`)
  assert(profile.emoji_usage.includes('frequency: low'), `emoji_usage=${profile.emoji_usage}`)
  assert(profile.line_break_style?.includes('rule: 문장마다') ?? false, `line_break_style=${profile.line_break_style}`)
  assert(profile.ai_tell_risks?.[0].includes('risk: 균일한 문단') ?? false, `ai_tell_risks=${profile.ai_tell_risks}`)
})

console.log('\n[2] buildVoiceFingerprintRules')

test('지문 잠금 규칙에 핵심 항목 포함', () => {
  const profile = normalizeProfileJson({
    tone: '담백한 후기 톤',
    formality: '존댓말',
    avg_sentence_length: 17,
    sentence_endings: ['~더라고요'],
    signature_phrases: ['개인적으로'],
    emoji_usage: '가끔',
    emoji_position: '문단 끝',
    emoji_timing: '마무리 뒤',
    photo_timing: '소제목 직후',
    paragraph_length: '1~2줄',
    spacing_style: '블로그식 띄어쓰기',
    line_break_style: '문장마다 줄바꿈',
    heading_usage: '가끔 씀',
    photo_comment_style: '사진 뒤 짧은 한마디',
    punctuation_style: 'ㅋㅋ는 적게',
    vocabulary_notes: '구체적인 감상어',
    ai_tell_risks: ['균일한 문단'],
    do_list: ['짧게 끊기'],
    dont_list: ['과장 금지'],
  })
  const rules = buildVoiceFingerprintRules(profile)
  for (const keyword of ['말버릇/시그니처 표현', '이모지 타이밍', '사진 삽입 타이밍', '줄넘김 방식', '띄어쓰기 방식', 'AI티 위험 요소', '반드시 살릴 습관', '피해야 할 습관']) {
    assert(rules.includes(keyword), `${keyword} 없음`)
  }
})

console.log('\n[3] generated text cleanup')

test('수평선을 제거하고 과한 빈 줄을 정리', () => {
  const cleaned = stripMarkdownHorizontalRules('# 제목\n\n문단1\n\n---\n\n문단2\n\n\n\n문단3')
  assert(!/^---$/m.test(cleaned), '수평선 제거 실패')
  assert(!/\n{3,}/.test(cleaned), '과한 빈 줄 정리 실패')
  assert(cleaned.includes('문단2'), '본문 손실')
})

console.log('\n[4] voice exemplars')

test('원문에서 말투 샘플을 추출하고 few-shot 규칙 생성', () => {
  const profile = normalizeProfileJson({
    signature_phrases: ['솔직 포인트', '아무튼'],
    emoji_usage: '가끔',
    do_list: ['짧게 끊기'],
  })
  const source = [
    '너무 짧음',
    '',
    '솔직 포인트 하나만 말하면요.\n이거 생각보다 괜찮았어요.딱 들어가자마자 조용해서 좋더라구요.\n아무튼 저는 또 갈 듯합니다 ㅋㅋㅋㅋ',
    '',
    'https://example.com 링크만 있는 문단은 점수 낮음',
  ].join('\n')

  const excerpts = extractVoiceExcerpts(source, profile)
  const rules = buildVoiceExemplarRules(source, profile)
  assert(excerpts.length > 0, '샘플 추출 실패')
  assert(excerpts[0].includes('솔직 포인트'), '시그니처 문단 우선 추출 실패')
  assert(rules.includes('줄넘김 간격'), 'few-shot 규칙 누락')
  assert(rules.includes('[샘플 1]'), '샘플 헤더 누락')
})

test('방문 후기는 장소/먹은 경험 샘플을 우선', () => {
  const source = [
    '제품 총평입니다.\n피부 클렌저 사용감이 생각보다 괜찮았고 충전 방식도 편했습니다 ㅎㅎ',
    '',
    '위치는 지하1층에 있습니다.밖에 보이는 간판 보고 슥 들어가면 바로 보여요.\n사실 처음 간 곳인데 생각보다 찾기 쉬웠습니다!!',
  ].join('\n')
  const excerpts = extractVoiceExcerpts(source, undefined, { postType: 'review' })
  assert(excerpts[0].includes('위치는'), `방문 후기 샘플 우선 실패: ${excerpts[0]}`)
})

console.log(`\n── 결과: ${passed} passed, ${failed} failed ──\n`)
if (failed > 0) {
  process.exit(1)
}
