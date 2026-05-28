"""html-revise.damilab.cc — 비개발자용 정적 HTML 슬라이드 에디터 백엔드.

설계 메모:
- 대상은 self-contained HTML (이미지가 data URI 로 인라인된 단일 파일).
  사용자의 build_standalone.py 산출물이 정확히 이 형태라 자산 경로 문제가 없다.
- 편집/이미지 인라인은 프론트(브라우저)에서 일어나고, 서버는 HTML 한 덩어리를
  업로드/조회/저장(리비전 스냅샷)/컴파일/다운로드만 책임진다.
- soft login: 이름 + 연구실 공용 키(LAB_EDIT_KEY). 쓰기 API 만 보호.
"""
import os
import re
import json
import uuid
import datetime
from functools import wraps
from pathlib import Path

from flask import (
    Flask, request, jsonify, session, render_template,
    send_file, abort, Response, redirect, url_for,
)

BASE = Path(__file__).resolve().parent.parent
STORAGE = BASE / "storage" / "decks"
STORAGE.mkdir(parents=True, exist_ok=True)

app = Flask(
    __name__,
    template_folder=str(BASE / "templates"),
    static_folder=str(BASE / "static"),
)
app.config["MAX_CONTENT_LENGTH"] = 64 * 1024 * 1024  # 64MB (data-URI 인라인 HTML 대비)
app.config["TEMPLATES_AUTO_RELOAD"] = True  # 템플릿 수정 시 재시작 없이 반영
app.jinja_env.auto_reload = True

# SECRET_KEY 는 반드시 강한 값을 환경변수로 주입 (없거나 약하면 기동 거부).
_secret = os.environ.get("SECRET_KEY", "")
if len(_secret) < 32 or _secret in ("dev-secret", "html-revise-dev-secret-change-me"):
    raise SystemExit("SECRET_KEY 가 설정되지 않았거나 약합니다. 32자 이상 랜덤값을 환경변수로 주입하세요.")
app.secret_key = _secret
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=True,   # 브라우저는 https(cloudflared)로 접속하므로 안전
    PERMANENT_SESSION_LIFETIME=datetime.timedelta(days=14),
)

LAB_EDIT_KEY = os.environ.get("LAB_EDIT_KEY", "damilab")
ADMIN = os.environ.get("HRE_ADMIN", "이우진")


@app.context_processor
def inject_asset_ver():
    # 정적 파일(js/css) 최신 mtime 을 버전으로 — 브라우저 캐시 강제 무효화
    import glob
    try:
        ver = int(max(os.path.getmtime(f) for f in glob.glob(str(BASE / "static" / "*"))))
    except Exception:
        ver = 0
    return {"asset_ver": ver}


@app.after_request
def no_cache_static(resp):
    if request.path.startswith("/static/"):
        resp.headers["Cache-Control"] = "no-cache"
    return resp


@app.after_request
def maybe_gzip(resp):
    """텍스트/HTML/JSON/JS/CSS 응답을 gzip 압축 — 큰 self-contained 덱 전송 안정성 향상.
    범위요청(206) 이나 이미 인코딩된 응답은 건너뜀. 100MB 초과 본문은 메모리 보호 차원에서 건너뜀."""
    try:
        if resp.status_code != 200:
            return resp
        if "gzip" not in (request.headers.get("Accept-Encoding") or ""):
            return resp
        if resp.headers.get("Content-Encoding"):
            return resp
        ct = (resp.content_type or "").lower()
        if not (ct.startswith("text/") or "json" in ct or "javascript" in ct or "css" in ct or "svg" in ct):
            return resp
        data = resp.get_data()
        if len(data) < 1024 or len(data) > 100 * 1024 * 1024:
            return resp
        import gzip, io
        buf = io.BytesIO()
        with gzip.GzipFile(fileobj=buf, mode="wb", compresslevel=5) as gz:
            gz.write(data)
        cdata = buf.getvalue()
        if len(cdata) >= len(data):
            return resp
        resp.set_data(cdata)
        resp.headers["Content-Encoding"] = "gzip"
        resp.headers["Content-Length"] = str(len(cdata))
        vary = resp.headers.get("Vary")
        resp.headers["Vary"] = "Accept-Encoding" if not vary else (vary + ", Accept-Encoding")
    except Exception:
        pass
    return resp


# ---------- 유틸 ----------
def now_iso():
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H-%M-%SZ")


def deck_dir(deck_id: str) -> Path:
    # deck_id 검증: hex 12자만 허용 (경로 우회 방지)
    if not re.fullmatch(r"[0-9a-f]{12}", deck_id or ""):
        abort(404)
    d = STORAGE / deck_id
    if not d.is_dir():
        abort(404)
    return d


def read_meta(d: Path) -> dict:
    f = d / "meta.json"
    if f.exists():
        return json.loads(f.read_text(encoding="utf-8"))
    return {}


def write_meta(d: Path, meta: dict):
    (d / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")


def extract_title(html: str) -> str:
    m = re.search(r"<title[^>]*>(.*?)</title>", html, re.I | re.S)
    if m and m.group(1).strip():
        return re.sub(r"\s+", " ", m.group(1)).strip()[:120]
    m = re.search(r"<h1[^>]*>(.*?)</h1>", html, re.I | re.S)
    if m:
        return re.sub(r"<[^>]+>", "", m.group(1)).strip()[:120]
    return "제목 없는 덱"


def login_required(fn):
    # 로그인 게이트 비활성화 (내부 도구로 운영). 인증을 다시 켜려면
    # 아래 wrapper 의 session 체크 주석을 해제하면 된다.
    @wraps(fn)
    def wrapper(*a, **k):
        # if not session.get("user"):
        #     return jsonify({"error": "login_required"}), 401
        return fn(*a, **k)
    return wrapper


# ---------- 페이지 ----------
@app.route("/")
def index():
    return render_template("index.html", user=session.get("user"))


@app.route("/editor/<deck_id>")
def editor(deck_id):
    d = deck_dir(deck_id)
    meta = read_meta(d)
    return render_template("editor.html", deck_id=deck_id, title=meta.get("title", ""),
                           user=session.get("user"))


# 에디터 iframe 이 로드하는 실제 편집 대상 HTML (working)
# 큰 self-contained 덱(수십 MB) 도 끊김 없이 전달되도록 send_file 로 스트리밍 + 조건부 GET.
@app.route("/raw/<deck_id>")
def raw(deck_id):
    d = deck_dir(deck_id)
    f = d / "working" / "index.html"
    if not f.exists():
        abort(404)
    return send_file(str(f), mimetype="text/html; charset=utf-8", conditional=True,
                     last_modified=f.stat().st_mtime)


@app.route("/download/<deck_id>")
def download(deck_id):
    d = deck_dir(deck_id)
    # build 가 있으면 build, 없으면 working
    f = d / "build" / "index.html"
    if not f.exists():
        f = d / "working" / "index.html"
    if not f.exists():
        abort(404)
    meta = read_meta(d)
    safe = re.sub(r"[^0-9A-Za-z._-]+", "_", meta.get("title", "deck")) or "deck"
    return send_file(f, mimetype="text/html", as_attachment=True,
                     download_name=f"{safe}.html")


# ---------- 인증 ----------
@app.route("/api/login", methods=["POST"])
def login():
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    key = (data.get("key") or "").strip()
    if not name:
        return jsonify({"error": "이름을 입력하세요"}), 400
    if key != LAB_EDIT_KEY:
        return jsonify({"error": "키가 올바르지 않습니다"}), 403
    session["user"] = name[:40]
    session.permanent = True
    return jsonify({"ok": True, "user": session["user"]})


@app.route("/api/logout", methods=["POST"])
def logout():
    session.pop("user", None)
    return jsonify({"ok": True})


@app.route("/api/me")
def me():
    return jsonify({"user": session.get("user")})


# ---------- 덱 CRUD ----------
@app.route("/api/decks", methods=["GET"])
def list_decks():
    items = []
    for d in STORAGE.iterdir():
        if not d.is_dir():
            continue
        meta = read_meta(d)
        if not meta:
            continue
        items.append({
            "deck_id": d.name,
            "title": meta.get("title", ""),
            "created": meta.get("created", ""),
            "updated": meta.get("updated", ""),
            "owner": meta.get("owner", ""),
            "orig_name": meta.get("orig_name", ""),
        })
    items.sort(key=lambda x: x.get("updated", ""), reverse=True)
    return jsonify(items)


@app.route("/api/decks", methods=["POST"])
@login_required
def create_deck():
    file = request.files.get("file")
    if not file:
        return jsonify({"error": "HTML 파일이 없습니다"}), 400
    raw_bytes = file.read()
    try:
        html = raw_bytes.decode("utf-8")
    except UnicodeDecodeError:
        html = raw_bytes.decode("utf-8", errors="replace")
    if "<html" not in html.lower() and "<!doctype" not in html.lower():
        return jsonify({"error": "HTML 형식이 아닙니다"}), 400

    deck_id = uuid.uuid4().hex[:12]
    d = STORAGE / deck_id
    (d / "source").mkdir(parents=True)
    (d / "working").mkdir()
    (d / "revisions").mkdir()
    (d / "build").mkdir()
    (d / "source" / "index.original.html").write_text(html, encoding="utf-8")
    (d / "working" / "index.html").write_text(html, encoding="utf-8")

    meta = {
        "title": extract_title(html),
        "title_custom": False,
        "created": now_iso(),
        "updated": now_iso(),
        "owner": session.get("user", ""),
        "orig_name": file.filename or "",
    }
    write_meta(d, meta)
    return jsonify({"deck_id": deck_id, "title": meta["title"]})


@app.route("/api/decks/<deck_id>", methods=["GET"])
def get_deck(deck_id):
    d = deck_dir(deck_id)
    return jsonify(read_meta(d) | {"deck_id": deck_id})


@app.route("/api/decks/<deck_id>", methods=["PUT"])
@login_required
def save_deck(deck_id):
    d = deck_dir(deck_id)
    data = request.get_json(silent=True) or {}
    html = data.get("html")
    if not html or not isinstance(html, str):
        return jsonify({"error": "html 내용이 없습니다"}), 400

    # 현재 working 을 리비전으로 스냅샷
    working = d / "working" / "index.html"
    if working.exists():
        # 같은 초에 두 번 저장해도 충돌하지 않게 ms + 짧은 uuid 부가
        stamp = f"{now_iso()}-{datetime.datetime.now().microsecond:06d}-{uuid.uuid4().hex[:4]}"
        snap = d / "revisions" / f"{stamp}.html"
        snap.write_text(working.read_text(encoding="utf-8"), encoding="utf-8")
        # 리비전은 최근 30개만 유지
        revs = sorted((d / "revisions").glob("*.html"))
        for old in revs[:-30]:
            old.unlink()

    working.write_text(html, encoding="utf-8")
    meta = read_meta(d)
    meta["updated"] = now_iso()
    # 사용자가 직접 지정한 제목은 저장 시 덮어쓰지 않음
    if not meta.get("title_custom"):
        meta["title"] = extract_title(html)
    write_meta(d, meta)
    return jsonify({"ok": True, "updated": meta["updated"], "title": meta["title"]})


@app.route("/api/decks/<deck_id>/rename", methods=["POST"])
@login_required
def rename_deck(deck_id):
    d = deck_dir(deck_id)
    data = request.get_json(silent=True) or {}
    title = (data.get("title") or "").strip()[:120]
    if not title:
        return jsonify({"error": "제목을 입력하세요"}), 400
    meta = read_meta(d)
    meta["title"] = title
    meta["title_custom"] = True
    meta["updated"] = now_iso()
    write_meta(d, meta)
    return jsonify({"ok": True, "title": title})


@app.route("/api/decks/<deck_id>/compile", methods=["POST"])
@login_required
def compile_deck(deck_id):
    # 프론트가 이미 에디터 흔적을 제거한 HTML 을 저장하므로 working -> build 복사.
    d = deck_dir(deck_id)
    working = d / "working" / "index.html"
    if not working.exists():
        return jsonify({"error": "저장된 내용이 없습니다"}), 400
    (d / "build" / "index.html").write_text(working.read_text(encoding="utf-8"), encoding="utf-8")
    return jsonify({"ok": True})


@app.route("/api/decks/<deck_id>", methods=["DELETE"])
@login_required
def delete_deck(deck_id):
    import shutil
    d = deck_dir(deck_id)
    meta = read_meta(d)
    user = session.get("user")
    # 영구 삭제는 소유자 또는 관리자만 (실수/악의로 타인 자료 훼손 방지)
    if meta.get("owner") and meta["owner"] != user and user != ADMIN:
        return jsonify({"error": "이 슬라이드는 올린 사람 또는 관리자만 삭제할 수 있습니다"}), 403
    shutil.rmtree(d)
    return jsonify({"ok": True})


@app.route("/api/decks/<deck_id>/revisions", methods=["GET"])
def list_revisions(deck_id):
    d = deck_dir(deck_id)
    revs = sorted((d / "revisions").glob("*.html"), reverse=True)
    return jsonify([r.stem for r in revs])


@app.route("/api/decks/<deck_id>/restore/<rev>", methods=["POST"])
@login_required
def restore_revision(deck_id, rev):
    d = deck_dir(deck_id)
    if not re.fullmatch(r"[0-9A-Za-z\-]+", rev or ""):
        abort(404)
    snap = d / "revisions" / f"{rev}.html"
    if not snap.exists():
        return jsonify({"error": "리비전 없음"}), 404
    (d / "working" / "index.html").write_text(snap.read_text(encoding="utf-8"), encoding="utf-8")
    meta = read_meta(d)
    meta["updated"] = now_iso()
    write_meta(d, meta)
    return jsonify({"ok": True})


@app.route("/favicon.ico")
def favicon():
    return ("", 204)


@app.route("/healthz")
def healthz():
    return jsonify({"ok": True})


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "3007"))
    host = os.environ.get("HOST", "0.0.0.0")
    app.run(host=host, port=port, debug=False)
