# HTML Revise 작업 하네스

Codex/Claude 가 HTML Revise 를 수정할 때 같은 기준으로 회귀를 잡는 자동 테스트.

## 실행
```bash
# (선택) 환경변수
export HTML_REVISE_BASE_URL="http://localhost:3007"   # 기본값
node tests/harness/scripts/run-all.mjs                # 전체
node tests/harness/scripts/smoke-home.mjs             # 개별
node tests/harness/scripts/smoke-upload-edit-save.mjs
node tests/harness/scripts/check-mobile-layout.mjs
```

## 검증 항목 (run-all)
- 홈 200 / 업로드·목록 렌더 / 데스크톱·모바일 가로스크롤 없음 / 콘솔 에러 없음
- 업로드 → 편집(텍스트·글씨크기·그림크기) → 저장 PUT 200 → 다운로드, 저장본에 수정 반영 + 에디터 흔적(contenteditable/hre-sel/hre-style/data-hre) 미잔류
- 멀티 슬라이드 이전/다음/경계
- 모바일 390/430/768: 가로스크롤 없음, 툴바 높이<=140, iframe>=40vh, 뷰모드 편집컨트롤 숨김, 편집모드 가로스크롤 없음

## 규칙
- 수정 전후로 `run-all` 실행, 새 실패만 골라 보고.
- 테스트 deck 은 제목/파일명 prefix `HARNESS_TEST_`, 실행 끝에 그 prefix 만 자동 삭제(운영 deck 보호).
- 로그인 키 등은 코드에 넣지 않고 환경변수로만.
- 리포트는 `reports/*.md`, 스크린샷은 `screenshots/`.

## 작업 흐름
새 UI 기능 추가 시 `lib/checks.mjs` 에 해당 검증을 먼저/함께 추가한다.
