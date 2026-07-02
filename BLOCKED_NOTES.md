# BLOCKED_NOTES

자동 작업 중 막혔거나, 합리적 기본값으로 우회한 항목 기록.

## 1. commerce_pack 실제 Claude API 생성 테스트 미실행

`.env.local`에 `ANTHROPIC_API_KEY`는 설정돼 있음을 확인했으나, 실제 생성 테스트를 돌리려면
1) Next dev 서버 기동, 2) Supabase에 실제 `voice_profiles` row 필요(말투 분석 선행 단계), 3) 실제 API 비용 발생.
무인 자동 작업 중 실 Supabase 프로젝트에 테스트용 row를 만들거나 실 API 비용을 발생시키는 건
"DB 부작용 최소화 + 비용 통제" 원칙상 보수적으로 보류함.

대신 [docs/sample-commerce-pack-output.md](docs/sample-commerce-pack-output.md)에 8섹션 구조·고지 위치·
usage_basis 분기를 손으로 작성한 예시로 대체. 실제 API 키로 1회 생성해보는 건 사람이 직접 트리거하는 걸 권장
(`/generate`에서 커머스 패키지 선택 → 상품 1개 입력 → 생성, 비용은 Sonnet 1회 호출 수준으로 적음).

## 2. Supabase 0001~0002 마이그레이션 실제 DB 미적용 확인 불가

로컬에서 실제 Supabase 프로젝트에 접속해 `information_schema.columns`를 조회할 권한/세션이 없어
0001/0002가 실제 DB에 적용됐는지 직접 검증은 못 함. 코드-마이그레이션 정합성은 grep으로 교차검증 완료.
**CEO가 Supabase 대시보드 SQL Editor에서 0002 SQL 실행 여부를 직접 확인 필요.**

## 3. (해결됨 — 2차 세션) publish_platform / tistory_url이 publish 라우트에서 실제로 안 쓰이던 문제

`review/page.tsx`는 발행 시 `platform`, `tistory_url`을 body로 보내지만 `publish/route.ts`는
`_req: NextRequest`로 요청 바디를 아예 안 읽던 버그. 2차 세션에서 `req.json()`을 읽도록 고쳐
`publish_platform`/`published_url` 컬럼에 실제로 저장되게 함 (대시보드 "보기" 링크가 이제 채워짐).
단, 티스토리는 "직접 붙여넣기" 흐름이라 실제 게시물 URL은 알 수 없어 `tistory_url`(블로그 주소)까지만 저장 — 정확한 포스트 URL은 여전히 모름. 상세는 `KNOWN_ISSUES.md` 참고.

## 4. (해결됨 — 3차 세션) score/route.ts commerce_pack 멀티섹션 오탐

3차 세션에서 "블로그 글" 섹션만 추출해서 채점하도록 수정. 섹션 추출 실패 시 전체 본문 fallback. KNOWN_ISSUES.md 2번 해결됨으로 표기됨.
