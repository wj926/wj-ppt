# wj-ppt — HTML 슬라이드 직접 수정 에디터

LLM(Claude 등)이 만든 **정적 HTML 슬라이드덱**을 브라우저에서 비개발자가 직접 고치는 웹 도구.
글자 수정·글씨 크기·그림 이동/크기·이미지 교체·박스 크기까지 클릭과 드래그로 바꾸고 저장한다.

> Edit LLM-generated static HTML slide decks right in the browser — click to edit text,
> drag to move/resize images and boxes, replace images, then save. No build step, no coding.

## 주요 기능

- **글자 수정**: 슬라이드의 글자를 클릭해서 바로 타이핑 (contenteditable)
- **글씨 크기/색/정렬**: 선택 요소 속성 패널 또는 `A− / A＋`
- **그림 이동·크기**: 드래그 이동 + 화살표 미세이동, **모서리 핸들 드래그**로 크기 조절(PPT식), `＋/－`, 이미지 교체(업로드 시 자동 축소·인라인)
- **박스(칸) 크기**: 글자가 든 칸을 선택해 너비/높이 조절
- **undo/redo + 자동저장**: `Ctrl+Z`/`Ctrl+Shift+Z`, 25초 자동저장, 리비전 스냅샷, 원본 보존
- **슬라이드 목차 / 페이지 직접 이동**
- **발표 모드**: 슬라이드만 전체화면
- **제목(프로젝트명) 변경**, 다운로드, 업로드 전 외부리소스 검사

대상 HTML: 이미지가 data URI 로 **인라인된 self-contained** 단일 HTML(1600×900 `.stage` 안 `.slide`). 자산 경로 문제가 없어 그대로 저장/공유된다.

## 빠른 시작

```bash
pip install -r requirements.txt        # Flask, Pillow
export SECRET_KEY=$(python -c "import secrets;print(secrets.token_hex(32))")
export PORT=3007
python -m backend.server
# http://localhost:3007 접속 → HTML 올리고 "편집 시작"
```

## 설정 (환경변수)

| 변수 | 설명 | 기본 |
|---|---|---|
| `SECRET_KEY` | Flask 세션 키 (32자+ 필수) | 없음(필수) |
| `PORT` / `HOST` | 서버 포트/호스트 | 3007 / 0.0.0.0 |
| `LAB_EDIT_KEY` | (선택) soft login 공용 키 | `damilab` |
| `HRE_ADMIN` | 삭제 권한 관리자 이름 | `이우진` |

> 로그인은 기본 **비활성**(내부 도구 가정). 다시 켜려면 `backend/server.py` 의 `login_required` 주석 두 줄을 해제.

## 구조

```
backend/server.py     Flask API (업로드/조회/저장+리비전/컴파일/다운로드/rename)
templates/            index.html(목록·업로드) · editor.html(에디터)
static/               app.* (목록) · editor.* (에디터 핵심 로직)
storage/decks/<id>/   source(원본)/working(현재)/revisions/build
tests/harness/        playwright 회귀 테스트 (node run-all.mjs)
```

## 테스트 (선택, 개발용)

```bash
# Chrome + playwright-core 필요
node tests/harness/scripts/run-all.mjs
# CHROME_BIN, PLAYWRIGHT_CORE 환경변수로 경로 지정 가능
```

## 라이선스

MIT
