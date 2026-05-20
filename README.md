# VoiceFit

블로그 글쓴이의 말투를 AI로 분석하고, 상품 정보를 입력하면 해당 말투로 블로그 포스팅을 자동 생성·발행하는 도구.

## 기술 스택

- **프레임워크**: Next.js 16 (App Router) + TypeScript + Tailwind CSS
- **DB / Storage**: Supabase (PostgreSQL + Storage)
- **AI**: OpenAI gpt-4.1-nano (텍스트 생성·채점·Vision)
- **자동화**: Playwright (네이버 블로그 자동 포스팅 — 로컬 전용)

## 빠른 시작

```bash
cp .env.example .env.local
# .env.local에 각 키 값 입력
npm install
npm run dev
```

http://localhost:3000 에서 세 화면(A: 말투 분석 → B: 글 생성 → C: 검수·발행)을 순서대로 진행합니다.

## 환경 변수

`.env.example` 파일을 복사해 `.env.local`을 만든 뒤 값을 채웁니다.

| 변수 | 설명 |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase 프로젝트 URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service_role key (서버 전용) |
| `OPENAI_API_KEY` | OpenAI API 키 |
| `COUPANG_ACCESS_KEY` / `COUPANG_SECRET_KEY` | 쿠팡 파트너스 API 키 (선택) |
| `UNSPLASH_ACCESS_KEY` | Unsplash API 키 (선택) |

## DB 마이그레이션

Supabase 대시보드 SQL Editor에서 `supabase/migrations/0001_init.sql` 실행.

---

## 네이버 자동 포스팅 (선택, 로컬 전용)

Playwright 기반으로 네이버 블로그에 자동 발행하는 기능입니다.  
미설정 시 기존 HTML/마크다운 폴백(복사 붙여넣기)으로 동작합니다.

### 활성화 방법

`.env.local`에 아래 세 줄 추가:

```
ALLOW_NAVER_AUTOMATION=1
NAVER_ID=테스트계정아이디
NAVER_PW=테스트계정비밀번호
```

```bash
npx playwright install chromium
```

### ⚠️ 필수 제약 — 반드시 읽을 것

1. **테스트 계정 전용**  
   자동화 전용 테스트 네이버 계정에서만 실행할 것.  
   메인 계정 사용 시 **계정 정지 위험**.

2. **로컬 전용**  
   `ALLOW_NAVER_AUTOMATION=1`은 로컬 `.env.local`에만 설정.  
   Vercel·외부 배포 서버에 설정 금지.  
   코드 내부에서 `process.env.VERCEL` 감지 시 자동으로 폴백 처리됨.

3. **본인 사용 한정**  
   공개 배포·타인 위임 금지.

4. **2단계 인증 미설정 계정 전용**  
   2FA가 설정된 계정에서는 로그인 차단 후 폴백 처리됨.

5. **저장소 공개 시 분리 권장**  
   `src/lib/naver-publisher.ts`는 봇 탐지 회피 로직을 포함하므로,  
   이 저장소를 공개 배포할 경우 해당 파일을 분리하는 것을 권장.

### 셀렉터 깨짐 대응

네이버 UI가 변경되어 자동 포스팅이 실패하면:

```
src/lib/naver-publisher.ts 상단의 SELECTORS 상수 수정
```

각 셀렉터에 "마지막 확인 날짜" 주석이 달려 있습니다.  
실패 시 브라우저 개발자 도구로 현재 DOM을 확인해 셀렉터를 갱신하세요.

### 동작 흐름

```
발행 버튼 클릭
  └─ ALLOW_NAVER_AUTOMATION=1 && !VERCEL?
        ├─ Yes → .naver-session.json 로드 → 로그인 확인
        │         → 글쓰기 → 제목/본문/이미지 입력 → 발행
        │         → 성공: naver_post_url 저장
        │         → 실패: 폴백(HTML/마크다운 복사)
        └─ No  → 폴백(HTML/마크다운 복사) ← 기본 동작
```
