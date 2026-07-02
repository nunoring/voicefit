# TOMORROW_TEST_PLAN

목표: 10분 안에 첫 테스트 성공.

---

## 내일 처음 볼 파일 3개

1. **이 파일** — 실행 순서
2. **AUTONOMOUS_WORK_REPORT_3.md** — 3차 작업에서 뭘 바꿨는지 요약
3. **docs/commerce-pack-test-inputs.md** — 바로 붙여넣을 샘플 입력 3개 + mock 설정 방법

---

## 실행 순서 (7단계)

### 1. Supabase migration 확인

Supabase 대시보드 → SQL Editor:

```sql
select column_name from information_schema.columns
where table_name = 'posts' order by column_name;
```

`post_type`, `content_json`, `publish_platform`, `published_url` 4개 컬럼 있는지 확인.
없으면 `supabase/migrations/0002_commerce_pack_and_missing_columns.sql` 내용 붙여넣어 실행 (idempotent).

### 2. mock 모드 켜기

`.env.local`에 한 줄 추가:
```
COMMERCE_PACK_MOCK=1
```

그 다음 dev 서버 시작:
```powershell
cd C:\Users\vacma\Desktop\apps\voicefit
npm run dev
```

### 3. mock 테스트 (비용 0)

`http://localhost:3000/generate` → 커머스 패키지 선택 → `docs/commerce-pack-test-inputs.md` 샘플 1개 복붙 → usage_basis 선택 → 생성.

확인:
- 결과 본문에 `[mock 모드 ...]` 문구가 있는가 (mock 작동 증거)
- 8섹션이 다 나오는가
- `/review` 이동 → 정책 감사 자동 실행되는가
- "섹션별 복사" 버튼들이 각 섹션 텍스트를 복사하는가

### 4. 실제 API 테스트 (소액 비용)

`.env.local`에서 `COMMERCE_PACK_MOCK=1` 줄 삭제 → dev 서버 재시작 → 같은 상품으로 다시 생성.

확인:
- 블로그 글 첫 부분에 "쿠팡 파트너스" 고지가 있는가
- usage_basis='사용 안 함'으로 넣었으면 "써보니", "써봤는데" 표현이 없는가
- 8섹션 제목이 정확히 나오는가

### 5. 정책 감사 확인

`/review` 화면 좌측에서 🔴/🟡/🟢 감사 결과 읽기.
🔴 fail 있으면 → 발행 버튼 위에 빨간 경고 배너 표시됨 (3차 신규 기능).
감사는 발행을 막지 않음 — 직접 본문 보고 판단.

### 6. 복사 버튼 확인

"발행하기" 클릭 (실제 외부 게시 아님 — 폴백 복사 화면만 뜸) → 섹션별 복사 9개 버튼 확인.

### 7. 실험 tracker 기록

`docs/commerce-experiment-tracker-template.csv`를 엑셀/구글시트로 열어서 오늘 테스트 1행 추가.

---

## 막히면

- `BLOCKED_NOTES.md` — 이미 알려진 막힘 항목
- `KNOWN_ISSUES.md` — score 오탐, tistory URL 등 알려진 이슈 (정상 동작임)
