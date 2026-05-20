/**
 * naver-publisher.ts — Playwright 기반 네이버 블로그 자동 포스팅
 *
 * ⚠️  경고 — 사용 전 반드시 확인:
 *   1. 테스트 계정 전용: 자동화 전용 테스트 네이버 계정에서만 실행할 것.
 *      메인 계정 사용 시 계정 정지 위험.
 *   2. 로컬 전용: ALLOW_NAVER_AUTOMATION=1 이고 VERCEL 미설정 환경에서만 동작.
 *      Vercel·외부 배포에서 절대 실행되지 않음.
 *   3. 본인 사용 한정: 공개 배포·타인 위임 금지.
 *   4. 2단계 인증 미설정 계정 전용.
 *   5. 이 파일은 봇 탐지 회피 로직을 포함하므로 저장소 공개 시 분리 권장.
 *
 * 셀렉터는 SELECTORS 상수로 분리되어 있음.
 * 네이버 UI 변경 시 SELECTORS 상수만 수정하면 됨.
 */

import path from 'path'
import fs from 'fs'
import type { Browser, BrowserContext, Page } from 'playwright'

// ── 환경 변수 가드 ────────────────────────────────────────────────────────────

export function isNaverAutomationEnabled(): boolean {
  return (
    process.env.ALLOW_NAVER_AUTOMATION === '1' &&
    !process.env.VERCEL
  )
}

// ── 셀렉터 상수 ───────────────────────────────────────────────────────────────
// 네이버 UI 변경 시 여기만 수정. 각 셀렉터는 확인 날짜 주석 포함.

const SELECTORS = {
  login: {
    // nid.naver.com/nidlogin.login?mode=form  — 확인: 2025-04
    idInput:          '#id',
    pwInput:          '#pw',
    submitBtn:        '.btn_login',
    // 캡차·2FA 감지용 — 이 요소가 보이면 즉시 중단
    captchaContainer: '#captcha_info',
    twoFactorOtp:     '#otp',
    twoFactorForm:    '#au_form',
  },
  editor: {
    // 블로그 글쓰기 — 네이버 Smart Editor 3 (SE3) 기준 — 확인: 2025-04
    // 에디터 iframe 래퍼
    editorFrame:      'iframe#mainFrame',
    // SE3 제목 입력
    titleInput:       '#subject',
    titleInputAlt:    '[placeholder*="제목"]',
    // SE3 본문 영역 (contenteditable)
    contentArea:      '.se-content-editor-container .se-content-editor',
    contentAreaAlt:   '[contenteditable="true"]',
    // 이미지 업로드 트리거 버튼 (툴바 내 이미지 버튼)
    imageBtn:         '.se-toolbar-item[data-module-id="image"]',
    imageBtnAlt:      'button[title="이미지"]',
    // 숨겨진 file input (이미지 업로드 시 DOM에 삽입됨)
    imageFileInput:   'input[type="file"][accept*="image"]',
    // 카테고리 드롭다운
    categorySelect:   '#category',
    // 태그 입력
    tagInput:         '.tag_editor input, .se-hashTag-input input',
    // 발행 버튼
    publishBtn:       '#publish-btn',
    publishBtnAlt:    '.btn_publish, button:has-text("발행")',
    // 발행 확인 다이얼로그
    confirmBtn:       '.btn_ok, button:has-text("확인")',
  },
}

// ── 유틸 ─────────────────────────────────────────────────────────────────────

const SESSION_FILE = path.join(process.cwd(), '.naver-session.json')

async function randomSleep(minMs = 250, maxMs = 900): Promise<void> {
  const ms = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs
  await new Promise((r) => setTimeout(r, ms))
}

function sessionExists(): boolean {
  return fs.existsSync(SESSION_FILE)
}

// ── 로그인 ────────────────────────────────────────────────────────────────────

async function login(page: Page, naverId: string, naverPw: string): Promise<void> {
  await page.goto('https://nid.naver.com/nidlogin.login?mode=form', {
    waitUntil: 'domcontentloaded',
    timeout: 15_000,
  })
  await randomSleep()

  await page.fill(SELECTORS.login.idInput, naverId)
  await randomSleep(300, 600)
  await page.fill(SELECTORS.login.pwInput, naverPw)
  await randomSleep(250, 500)
  await page.click(SELECTORS.login.submitBtn)
  await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15_000 })
}

async function detectLoginBlock(page: Page): Promise<boolean> {
  const url = page.url()
  if (url.includes('nidlogin') || url.includes('/login')) {
    const hasCaptcha = (await page.locator(SELECTORS.login.captchaContainer).count()) > 0
    const has2FA =
      (await page.locator(SELECTORS.login.twoFactorOtp).count()) > 0 ||
      (await page.locator(SELECTORS.login.twoFactorForm).count()) > 0
    if (hasCaptcha || has2FA) return true
    // 로그인 실패 (아직 로그인 페이지에 있음)
    return true
  }
  return false
}

// ── 에디터 내 콘텐츠 삽입 ──────────────────────────────────────────────────────

async function insertTitle(page: Page, title: string): Promise<void> {
  const titleSel = SELECTORS.editor.titleInput
  const titleAlt  = SELECTORS.editor.titleInputAlt

  let titleEl = page.locator(titleSel)
  if (!(await titleEl.count())) titleEl = page.locator(titleAlt)

  await titleEl.first().click()
  await randomSleep()
  await titleEl.first().fill(title)
  await randomSleep()
}

async function insertBody(page: Page, bodyHtml: string): Promise<void> {
  // SE3는 contenteditable div. 클립보드로 HTML 붙여넣기 시도.
  const contentSel = SELECTORS.editor.contentArea
  const contentAlt = SELECTORS.editor.contentAreaAlt

  let contentEl = page.locator(contentSel)
  if (!(await contentEl.count())) contentEl = page.locator(contentAlt).first()

  await contentEl.click()
  await randomSleep()

  // 클립보드 HTML 페이스트
  await page.evaluate((html: string) => {
    const el = document.querySelector<HTMLElement>(
      '.se-content-editor-container .se-content-editor, [contenteditable="true"]',
    )
    if (!el) return
    el.focus()
    const dt = new DataTransfer()
    dt.setData('text/html', html)
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }))
  }, bodyHtml)

  await randomSleep(500, 900)
}

async function uploadImages(page: Page, imagePaths: string[]): Promise<void> {
  if (!imagePaths.length) return

  for (const imgPath of imagePaths) {
    if (!fs.existsSync(imgPath)) continue

    // 이미지 버튼 클릭
    const imgBtn = page.locator(SELECTORS.editor.imageBtn)
    if (!(await imgBtn.count())) {
      const imgBtnAlt = page.locator(SELECTORS.editor.imageBtnAlt)
      if (await imgBtnAlt.count()) await imgBtnAlt.first().click()
    } else {
      await imgBtn.first().click()
    }

    await randomSleep(400, 800)

    // file input에 파일 세팅
    const fileInput = page.locator(SELECTORS.editor.imageFileInput)
    if (await fileInput.count()) {
      await fileInput.setInputFiles(imgPath)
      await randomSleep(600, 1200)
    }
  }
}

async function setCategory(page: Page, category: string): Promise<void> {
  const sel = page.locator(SELECTORS.editor.categorySelect)
  if (!(await sel.count())) return
  await sel.selectOption({ label: category })
  await randomSleep()
}

async function addTags(page: Page, tags: string[]): Promise<void> {
  if (!tags.length) return
  const tagInput = page.locator(SELECTORS.editor.tagInput)
  if (!(await tagInput.count())) return

  for (const tag of tags) {
    await tagInput.first().fill(tag)
    await randomSleep(200, 400)
    await page.keyboard.press('Enter')
    await randomSleep(200, 400)
  }
}

async function clickPublish(page: Page): Promise<void> {
  const publishBtn = page.locator(SELECTORS.editor.publishBtn)
  if (await publishBtn.count()) {
    await publishBtn.click()
  } else {
    await page.locator(SELECTORS.editor.publishBtnAlt).first().click()
  }
  await randomSleep(400, 700)

  // 발행 확인 다이얼로그가 있을 경우
  const confirmBtn = page.locator(SELECTORS.editor.confirmBtn)
  if (await confirmBtn.count()) {
    await confirmBtn.first().click()
    await randomSleep(400, 700)
  }

  await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20_000 })
}

// ── 메인 발행 함수 ─────────────────────────────────────────────────────────────

export interface PublishToNaverParams {
  title: string
  bodyHtml: string
  imagePaths?: string[]
  category?: string
  tags?: string[]
}

export type PublishToNaverResult =
  | { ok: true; url: string }
  | { ok: false; reason: string }

export async function publishToNaver(
  params: PublishToNaverParams,
): Promise<PublishToNaverResult> {
  // ── 안전 가드 ──────────────────────────────────────────────────────────────
  if (process.env.ALLOW_NAVER_AUTOMATION !== '1') {
    return { ok: false, reason: 'automation_disabled: ALLOW_NAVER_AUTOMATION 미설정' }
  }
  if (process.env.VERCEL) {
    return { ok: false, reason: 'not_allowed_in_vercel' }
  }

  const naverId = process.env.NAVER_ID
  const naverPw = process.env.NAVER_PW
  if (!naverId || !naverPw) {
    return { ok: false, reason: 'missing_credentials: NAVER_ID 또는 NAVER_PW 미설정' }
  }

  // ── playwright 동적 임포트 (빌드 번들 제외 목적) ────────────────────────────
  const { chromium } = await import('playwright')

  let browser: Browser | null = null
  let context: BrowserContext | null = null

  try {
    // ── 브라우저 기동 ──────────────────────────────────────────────────────
    browser = await chromium.launch({
      headless: false,
      args: ['--disable-blink-features=AutomationControlled'],
    })

    const ctxOptions: Parameters<Browser['newContext']>[0] = {
      locale: 'ko-KR',
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    }

    // 세션 재사용
    if (sessionExists()) {
      ctxOptions.storageState = SESSION_FILE
    }

    context = await browser.newContext(ctxOptions)
    const page = await context.newPage()

    // ── 로그인 확인 & 필요 시 로그인 ──────────────────────────────────────
    await page.goto(`https://blog.naver.com/${naverId}`, {
      waitUntil: 'domcontentloaded',
      timeout: 15_000,
    })
    await randomSleep()

    const needsLogin =
      page.url().includes('nidlogin') ||
      page.url().includes('/login') ||
      page.url().includes('nid.naver.com')

    if (needsLogin) {
      try {
        await login(page, naverId, naverPw)
      } catch (e) {
        return {
          ok: false,
          reason: `login_error: ${e instanceof Error ? e.message : String(e)}`,
        }
      }

      if (await detectLoginBlock(page)) {
        return { ok: false, reason: 'login_blocked: 캡차 또는 2단계 인증 감지' }
      }

      // 세션 저장
      try {
        await context.storageState({ path: SESSION_FILE })
      } catch { /* 세션 저장 실패는 비치명적 */ }
    }

    // ── 글쓰기 페이지 이동 ─────────────────────────────────────────────────
    try {
      await page.goto(
        `https://blog.naver.com/PostWriteForm.naver?blogId=${naverId}`,
        { waitUntil: 'domcontentloaded', timeout: 20_000 },
      )
    } catch (e) {
      return {
        ok: false,
        reason: `navigate_write_error: ${e instanceof Error ? e.message : String(e)}`,
      }
    }

    await randomSleep(600, 1000)

    // 이동 후 로그인 차단 재확인
    if (await detectLoginBlock(page)) {
      return { ok: false, reason: 'login_blocked: 글쓰기 이동 후 로그인 감지' }
    }

    // ── 제목 입력 ──────────────────────────────────────────────────────────
    try {
      await insertTitle(page, params.title)
    } catch (e) {
      return {
        ok: false,
        reason: `title_error: ${e instanceof Error ? e.message : String(e)}`,
      }
    }

    // ── 본문 입력 ──────────────────────────────────────────────────────────
    try {
      await insertBody(page, params.bodyHtml)
    } catch (e) {
      return {
        ok: false,
        reason: `body_error: ${e instanceof Error ? e.message : String(e)}`,
      }
    }

    // ── 이미지 업로드 ──────────────────────────────────────────────────────
    if (params.imagePaths?.length) {
      try {
        await uploadImages(page, params.imagePaths)
      } catch (e) {
        // 이미지 업로드 실패는 비치명적 — 계속 진행
        console.warn('[naver-publisher] 이미지 업로드 실패:', e)
      }
    }

    // ── 카테고리 ───────────────────────────────────────────────────────────
    if (params.category) {
      try {
        await setCategory(page, params.category)
      } catch { /* 비치명적 */ }
    }

    // ── 태그 ───────────────────────────────────────────────────────────────
    if (params.tags?.length) {
      try {
        await addTags(page, params.tags)
      } catch { /* 비치명적 */ }
    }

    // ── 발행 ───────────────────────────────────────────────────────────────
    try {
      await clickPublish(page)
    } catch (e) {
      return {
        ok: false,
        reason: `publish_error: ${e instanceof Error ? e.message : String(e)}`,
      }
    }

    const resultUrl = page.url()

    // 발행 후 세션 갱신 저장
    try {
      await context.storageState({ path: SESSION_FILE })
    } catch { /* 비치명적 */ }

    return { ok: true, url: resultUrl }
  } catch (e) {
    return {
      ok: false,
      reason: `unexpected_error: ${e instanceof Error ? e.message : String(e)}`,
    }
  } finally {
    try { await context?.close() } catch { /* 무시 */ }
    try { await browser?.close() } catch { /* 무시 */ }
  }
}
