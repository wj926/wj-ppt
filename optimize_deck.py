"""덱 working/index.html 안 base64 인라인 이미지들을 1100px·JPEG q86 으로 재인코딩.
사용: python optimize_deck.py <deck_id> [<deck_id> ...]
원본은 source/index.original.html 그대로 두고, 적용 직전 working 을 revisions 에 스냅샷.
"""
import sys, re, base64, io, datetime, uuid
from pathlib import Path
from PIL import Image

STORAGE = Path(__file__).resolve().parent / "storage" / "decks"
MAX_DIM = 1100
JPEG_Q = 86
DATA_RE = re.compile(r'src=(["\'])data:image/(png|jpe?g|webp);base64,([A-Za-z0-9+/=]+)\1', re.I)


def optimize_dataurl(kind: str, b64: str):
    try:
        raw = base64.b64decode(b64)
    except Exception:
        return None
    try:
        im = Image.open(io.BytesIO(raw))
        im.load()
    except Exception:
        return None
    w, h = im.size
    m = max(w, h)
    keep_alpha = (im.mode in ("RGBA", "LA", "P") and "A" in im.getbands())
    # 작은 이미지(이미 1100 이하) 면서 압축률 낮을 가능성 — 그래도 재인코딩 시도
    if m > MAX_DIM:
        r = MAX_DIM / m
        im = im.resize((int(w * r), int(h * r)), Image.LANCZOS)
    buf = io.BytesIO()
    if keep_alpha:
        im.save(buf, "PNG", optimize=True)
        new_b64 = base64.b64encode(buf.getvalue()).decode()
        new_kind = "png"
    else:
        rgb = im.convert("RGB") if im.mode != "RGB" else im
        rgb.save(buf, "JPEG", quality=JPEG_Q, optimize=True)
        new_b64 = base64.b64encode(buf.getvalue()).decode()
        new_kind = "jpeg"
    # 원본보다 클 때는 유지
    if len(new_b64) >= len(b64):
        return None
    return new_kind, new_b64


def optimize_file(html: str):
    saved_total = 0
    n_done = 0
    def repl(m):
        nonlocal saved_total, n_done
        q, kind, b64 = m.group(1), m.group(2).lower(), m.group(3)
        out = optimize_dataurl(kind, b64)
        if not out:
            return m.group(0)
        new_kind, new_b64 = out
        saved_total += len(b64) - len(new_b64)
        n_done += 1
        return f'src={q}data:image/{new_kind};base64,{new_b64}{q}'
    new_html = DATA_RE.sub(repl, html)
    return new_html, n_done, saved_total


def now_stamp():
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H-%M-%SZ") \
        + f"-{datetime.datetime.now().microsecond:06d}-{uuid.uuid4().hex[:4]}"


def main(ids):
    for deck_id in ids:
        d = STORAGE / deck_id
        wf = d / "working" / "index.html"
        if not wf.exists():
            print(f"[skip] {deck_id} working/index.html 없음")
            continue
        html = wf.read_text(encoding="utf-8")
        before = len(html)
        # 안전망: 적용 전 스냅샷
        snap = d / "revisions" / f"{now_stamp()}.html"
        snap.parent.mkdir(exist_ok=True)
        snap.write_text(html, encoding="utf-8")
        new_html, n, saved = optimize_file(html)
        after = len(new_html)
        wf.write_text(new_html, encoding="utf-8")
        print(f"[ok]  {deck_id}: {n}개 이미지 최적화, {before/1e6:.2f}MB -> {after/1e6:.2f}MB (-{(before-after)/1e6:.2f}MB, {(1-after/before)*100:.1f}%)")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__); sys.exit(2)
    main(sys.argv[1:])
