# KNOWN_ISSUES

손대지 않고 남겨둔(또는 부분만 고친) 기존 이슈 정리. 작아서 즉시 고친 것은 `BLOCKED_NOTES.md`에 "해결됨"으로 표기.

## 1. publish 라우트 — tistory 발행 URL이 부정확함 (부분 해결)

2차 세션에서 `publish/route.ts`가 요청 바디(`platform`, `tistory_url`)를 안 읽던 버그는 고쳤다.
다만 티스토리/네이버 둘 다 "사람이 에디터에 직접 붙여넣는" 반자동 흐름이라, 앱은 **실제로 게시된 포스트 URL을 알 방법이 없다**.
지금은 사용자가 입력한 "블로그 주소"(예: `myblog.tistory.com`)를 `published_url`에 그대로 저장하는데,
이건 그 포스트의 정확한 URL이 아니라 블로그 홈 주소다. 대시보드 "보기" 링크를 누르면 블로그 홈으로 가지, 그 글로 바로 가지 않는다.

**정확히 고치려면**: 발행 후 사람이 직접 게시물 URL을 붙여넣는 입력칸을 검수 화면에 추가하거나,
체크리스트 완료 시점에 "게시 완료, URL: ___" 같은 별도 단계가 필요함. 이번 세션 범위(정책감사·mock모드 우선) 밖이라 보류.

## 2. ✅ (3차 해결됨) score/route.ts — commerce_pack "블로그 글" 섹션만 추출해서 채점

3차 세션에서 `splitCommerceSections`를 score route에 import해 commerce_pack일 때 "블로그 글" 섹션만 추출해서 채점하도록 수정.
섹션 추출 실패(AI가 헤더를 변형한 경우)엔 전체 본문으로 fallback.
product/daily/review/coupang은 변경 없음.

## 3. Naver/Playwright 자동발행 경로는 `tistory_url`을 안 씀 (의도된 동작, 버그 아님)

`publish/route.ts`의 Playwright 경로는 네이버 전용이라 `tistory_url` 파라미터를 참조하지 않는다 — 정상.
혹시 나중에 "네이버 URL을 직접 입력하는 수동 모드"를 추가한다면 그때 이 구조를 재사용할 수 있음.

## 4. commerce-audit의 "의심 표현" 검사는 휴리스틱일 뿐 (오탐/누락 둘 다 있음)

`auditCommercePack()`의 7번 검사(할인율/수익/효능 수치 패턴)는 정규식 기반이라:
- 오탐: 입력 상품정보에 실제로 있는 정상적인 수치도 "의심"으로 뜰 수 있음 (예: 실제 30% 할인 상품)
- 누락: 패턴에 없는 표현으로 우회한 과장 주장은 못 잡음

그래서 severity를 `fail`이 아니라 `warn`으로만 설정했고, 메시지에도 "직접 대조 확인하세요"를 명시했다.
이 검사를 "확정 판정"으로 쓰면 안 됨 — 사람 검수를 대체하지 않는다.
