// html-revise 에디터 — 부모 페이지에서 iframe 내부 슬라이드 문서를 직접 조작.
(function () {
  const deckId = window.HRE.deckId;
  const loggedIn = true;  // 로그인 비활성화 (내부 도구)
  const frame = document.getElementById("frame");
  const $ = (s) => document.getElementById(s);

  let doc = null, win = null;
  let editMode = false;
  let sel = null;        // 선택된 요소
  let selType = null;    // 'text' | 'image'
  let editingText = null;
  // undo/redo + 자동저장 상태
  let history = [], hi = -1, dirty = false, saving = false, snapTimer = null, editSeq = 0;
  let changeCount = { text: 0, image: 0 };  // 변경 요약용

  // ---------- 토스트 ----------
  function toast(msg, isErr) {
    let t = document.getElementById("hre-toast");
    if (!t) {
      t = document.createElement("div"); t.id = "hre-toast";
      t.style.cssText = "position:fixed;bottom:54px;left:50%;transform:translateX(-50%);background:#05264e;color:#fff;padding:11px 20px;border-radius:8px;font-size:14px;box-shadow:0 8px 24px rgba(0,0,0,.3);opacity:0;transition:.25s;z-index:99;pointer-events:none";
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.style.background = isErr ? "#b4424d" : "#05264e";
    t.style.opacity = "1";
    clearTimeout(t._h); t._h = setTimeout(() => (t.style.opacity = "0"), 2600);
  }

  // ---------- iframe 로드 ----------
  frame.addEventListener("load", () => {
    try {
      doc = frame.contentDocument;
      win = frame.contentWindow;
    } catch (e) { toast("슬라이드를 불러오지 못했습니다", true); return; }
    injectStyle();
    syncPage();
    win.addEventListener("hashchange", syncPage);
    // 편집 모드에서 클릭/키 처리 (capture 단계로 덱 자체 핸들러보다 먼저)
    doc.addEventListener("click", onDocClick, true);
    doc.addEventListener("mousedown", onDocMouseDown, true);
    doc.addEventListener("keydown", onDocKeyDown, true);
    doc.addEventListener("input", (e) => {
      if (editingText) editingText._dirtyText = true;
      markDirty(); schedulePush(700);
    }, true);
    doc.addEventListener("paste", handlePaste, true);
    // 텍스트 편집 커밋 시 변경 카운트
    doc.addEventListener("focusout", (e) => {
      if (e.target && e.target._dirtyText) { changeCount.text++; e.target._dirtyText = false; }
    }, true);
    setTimeout(() => { pushHistory(); setStatus(""); }, 300);  // baseline 스냅샷
  });

  function injectStyle() {
    if (doc.getElementById("hre-style")) return;
    const st = doc.createElement("style");
    st.id = "hre-style"; st.setAttribute("data-hre", "1");
    st.textContent = `
      body.hre-edit *{cursor:default}
      body.hre-edit [contenteditable="true"]{outline:2px dashed #1d4ed8;outline-offset:2px;background:rgba(255,247,170,.55);cursor:text}
      .hre-sel{outline:2.5px solid #1f8a4c !important;outline-offset:2px}
      .hre-sel-img{outline:2.5px solid #b4424d !important;outline-offset:2px;cursor:move}
      .hre-sel-box{outline:2.5px solid #6d28d9 !important;outline-offset:1px}
    `;
    doc.head.appendChild(st);
  }

  // ---------- 변경 상태 / 자동저장 ----------
  function setStatus(text, cls) {
    const el = $("saveStatus"); if (!el) return;
    el.textContent = text; el.className = "savestat" + (cls ? " " + cls : "");
  }
  function markDirty(kind) {
    dirty = true; editSeq++; setStatus("수정됨 (저장 안 함)", "dirty");
    if (kind && changeCount[kind] != null) changeCount[kind]++;
  }
  // 대기 중인 텍스트 스냅샷을 즉시 확정 (undo/redo/save 직전)
  function flushPending() { if (snapTimer) { clearTimeout(snapTimer); snapTimer = null; pushHistory(); } }
  // 브라우저 위치와 무관하게 항상 한국시간(KST)으로 표시
  function hhmm() { return new Date().toLocaleTimeString("ko-KR", { timeZone: "Asia/Seoul", hour12: false, hour: "2-digit", minute: "2-digit" }); }

  // ---------- undo/redo ----------
  function snapshot() {
    const c = doc.body.cloneNode(true);
    c.querySelectorAll("[contenteditable]").forEach((e) => e.removeAttribute("contenteditable"));
    c.querySelectorAll(".hre-sel,.hre-sel-img,.hre-sel-box").forEach((e) => e.classList.remove("hre-sel", "hre-sel-img", "hre-sel-box"));
    return c.innerHTML;
  }
  function pushHistory() {
    if (!doc) return;
    const snap = snapshot();
    if (hi >= 0 && history[hi] === snap) return;  // 변화 없으면 skip
    history = history.slice(0, hi + 1);
    history.push(snap);
    if (history.length > 12) history.shift();      // 메모리 보호 (큰 덱 대비)
    hi = history.length - 1;
    updateUndoButtons();
  }
  function schedulePush(delay) {
    clearTimeout(snapTimer);
    snapTimer = setTimeout(pushHistory, delay || 600);
  }
  function restore(html) {
    clearSelection();
    doc.body.innerHTML = html;
    markDirty();
    syncPage();
    updateUndoButtons();
  }
  function undo() { flushPending(); if (hi > 0) { hi--; restore(history[hi]); } }
  function redo() { if (hi < history.length - 1) { hi++; restore(history[hi]); } }
  function updateUndoButtons() {
    const u = $("undoBtn"), rd = $("redoBtn");
    if (u) u.disabled = hi <= 0;
    if (rd) rd.disabled = hi >= history.length - 1;
  }
  $("undoBtn").onclick = undo;
  $("redoBtn").onclick = redo;

  // ---------- 제목(프로젝트명) 변경 ----------
  $("etitle").style.cursor = "pointer";
  $("etitle").title = "클릭해 제목(프로젝트명) 변경";
  $("etitle").onclick = async () => {
    const cur = $("etitle").textContent.trim();
    const t = prompt("프로젝트 이름(제목)", cur);
    if (t === null) return;
    const name = t.trim(); if (!name) return;
    try {
      const r = await fetch(`/api/decks/${deckId}/rename`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: name }),
      });
      const j = await r.json();
      if (r.ok) { $("etitle").textContent = j.title; document.title = "편집 · " + j.title; toast("제목을 바꿨습니다"); }
      else toast(j.error || "제목 변경 실패", true);
    } catch (e) { toast("제목 변경 오류", true); }
  };

  async function autosaveTick() {
    if (dirty && !saving && editMode) await save(true);
  }
  setInterval(autosaveTick, 25000);

  // ---------- 페이지 네비 ----------
  function slides() { return doc ? Array.from(doc.querySelectorAll(".slide")) : []; }
  function curIndex() {
    const ss = slides();
    const i = ss.findIndex((s) => s.classList.contains("active"));
    if (i >= 0) return i;
    const h = parseInt((win.location.hash || "#1").slice(1), 10);
    return isNaN(h) ? 0 : Math.max(0, h - 1);
  }
  function syncPage() {
    const ss = slides(); if (!ss.length) { $("pageInd").textContent = "– / –"; return; }
    $("pageInd").textContent = `${curIndex() + 1} / ${ss.length}`;
    highlightRail();
    positionHandle();
  }
  function goto(n) {
    const ss = slides(); if (!ss.length || isNaN(n)) return;
    n = Math.max(1, Math.min(ss.length, n));
    win.location.hash = "#" + n;
    setTimeout(syncPage, 60);
  }
  $("prevBtn").onclick = () => goto(curIndex());      // curIndex()+1-1
  $("nextBtn").onclick = () => goto(curIndex() + 2);
  // 페이지 번호 직접 이동
  $("pageInd").onclick = () => {
    const n = prompt("이동할 페이지 번호", curIndex() + 1);
    if (n !== null) goto(parseInt(n, 10));
  };

  // ---------- 슬라이드 목차 레일 ----------
  function escapeHtml(s) { return (s || "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c])); }
  function buildRail() {
    const rail = $("railPanel"); if (!rail) return;
    const ss = slides();
    rail.innerHTML = ss.map((s, idx) => {
      const h = s.querySelector("h1, h2, .h2, .head h1, .title");
      const t = h ? h.textContent.trim().slice(0, 50) : "(제목 없음)";
      return `<button class="railitem" data-n="${idx + 1}"><b>${idx + 1}</b><span>${escapeHtml(t)}</span></button>`;
    }).join("");
    rail.querySelectorAll(".railitem").forEach((b) => {
      b.onclick = () => goto(parseInt(b.dataset.n, 10));
    });
    highlightRail();
  }
  function highlightRail() {
    const rail = $("railPanel"); if (!rail || rail.hidden) return;
    const cur = curIndex() + 1;
    rail.querySelectorAll(".railitem").forEach((b) => b.classList.toggle("on", +b.dataset.n === cur));
  }
  $("railBtn").onclick = () => {
    const rail = $("railPanel");
    rail.hidden = !rail.hidden;
    $("railBtn").classList.toggle("on", !rail.hidden);
    if (!rail.hidden) { buildRail(); }
  };

  // ---------- 스케일 (스크린px -> 무대px) ----------
  function stageScale() {
    const st = doc.querySelector(".stage");
    if (!st) return 1;
    const r = st.getBoundingClientRect();
    const base = st.offsetWidth || 1600;
    return r.width / base || 1;
  }

  // ---------- 편집 모드 ----------
  $("modeBtn").onclick = () => {
    if (!loggedIn) { toast("목록 화면에서 로그인 후 편집하세요", true); return; }
    editMode = !editMode;
    doc.body.classList.toggle("hre-edit", editMode);
    $("modeBtn").textContent = editMode ? "편집 끝(보기)" : "편집 시작";
    $("modeBtn").classList.toggle("on", editMode);
    $("editControls").hidden = !editMode;
    const hb = $("hintbar");
    hb.classList.toggle("edit", editMode);
    hb.innerHTML = editMode
      ? "글자/그림 <b>클릭</b>해 수정·이동·크기 · <b>Ctrl+V</b> 이미지 붙여넣기 · 선택 후 <b>Del</b> 삭제 · 끝나면 <b>저장</b>"
      : "편집을 시작하려면 우측 상단 <b>편집 시작</b>을 누르세요.";
    if (!editMode) clearSelection();
  };

  // ---------- 선택 ----------
  const TEXT_SEL = "li,p,h1,h2,h3,h4,figcaption,td,th,.lead,.takeaway,.h2,.dsc,.ex,.ct,.rv,.rt,.hl,.tag,.big,.sm,.n,.l,.lab,.ck,.tk,.takeaway";
  function clearSelection() {
    if (editingText) { editingText.removeAttribute("contenteditable"); editingText = null; }
    if (sel) { sel.classList.remove("hre-sel", "hre-sel-img", "hre-sel-box"); }
    sel = null; selType = null;
    updateProp();
  }
  function selectImage(img) {
    clearSelection(); sel = img; selType = "image"; img.classList.add("hre-sel-img");
    // 저장본 재오픈 등으로 transform 만 남고 dataset 이 없으면 복원 (이동 점프 방지)
    if (img.dataset.hretx == null && img.style.transform) {
      const m = img.style.transform.match(/translate\(\s*(-?[\d.]+)px\s*,\s*(-?[\d.]+)px/);
      if (m) { img.dataset.hretx = m[1]; img.dataset.hrety = m[2]; }
    }
    updateProp();
  }
  // 클릭 지점에서 "텍스트를 직접 담은 가장 작은 칸"을 일반적으로 찾는다 (클래스 화이트리스트 없이)
  const STOP_TAGS = ["UL", "OL", "TABLE", "THEAD", "TBODY", "TR", "FIGURE", "SECTION", "HTML", "HEAD", "BODY"];
  function hasBlockTextChildren(el) {
    return [...el.children].some((c) => {
      if (!c.textContent || !c.textContent.trim()) return false;
      const d = win.getComputedStyle(c).display;
      return d === "block" || d === "flex" || d === "grid" || d === "list-item" || d.startsWith("table") || c.tagName === "IMG";
    });
  }
  function pickTextEl(t) {
    let el = t;
    while (el && el !== doc.body) {
      if (STOP_TAGS.includes(el.tagName)) return null;
      if (el.textContent && el.textContent.trim() && !hasBlockTextChildren(el)) return el;
      el = el.parentElement;
    }
    return null;
  }
  function selectText(el) {
    clearSelection(); sel = el; selType = "text"; el.classList.add("hre-sel");
    el.setAttribute("contenteditable", "true"); editingText = el; el._dirtyText = false;
    el.focus();
    updateProp();
  }
  // 박스(칸) 선택 — 크기 조절용
  function selectBox(el) {
    if (!el || el === doc.body) { toast("더 위 박스가 없습니다", true); return; }
    clearSelection(); sel = el; selType = "box"; el.classList.add("hre-sel-box");
    updateProp();
  }

  function onDocClick(e) {
    if (!editMode) return;
    // 편집 모드에서는 덱 자체의 "클릭하면 다음 슬라이드" 동작을 전면 차단
    e.stopPropagation();
    const t = e.target;
    if (t.tagName === "IMG") {
      e.preventDefault();
      selectImage(t); return;
    }
    const txt = pickTextEl(t);
    if (txt) {
      if (editingText === txt) return;  // 같은 요소 재클릭이면 캐럿만 이동
      selectText(txt);
      return;
    }
    // 텍스트를 못 찾으면(칸 여백 등) 선택 해제
    if (selType) clearSelection();
  }

  // ---------- 선택 요소 속성 패널 ----------
  function rgbToHex(rgb) {
    const m = (rgb || "").match(/\d+/g);
    if (!m) return "#000000";
    return "#" + m.slice(0, 3).map((x) => (+x).toString(16).padStart(2, "0")).join("");
  }
  function updateProp() {
    const p = $("propPanel"); if (!p) return;
    if (!editMode || !sel) { p.hidden = true; p.innerHTML = ""; return; }
    p.hidden = false;
    if (selType === "text") {
      const cs = win.getComputedStyle(sel);
      const fs = Math.round(parseFloat(sel.style.fontSize || cs.fontSize));
      const bw = sel.style.fontWeight || cs.fontWeight; const isBold = bw === "bold" || +bw >= 600;
      const col = rgbToHex(cs.color);
      p.innerHTML = `<div class="ptitle">글자 속성</div>
        <label>크기 <input type="number" id="pp_fs" value="${fs}" min="8" max="200" step="1"> px</label>
        <label><input type="checkbox" id="pp_bold" ${isBold ? "checked" : ""}> 굵게</label>
        <label>색 <input type="color" id="pp_color" value="${col}"></label>
        <div class="palign">정렬 <button data-al="left">좌</button><button data-al="center">가운데</button><button data-al="right">우</button></div>
        <button class="pp_reset" id="pp_box">이 글자가 든 박스(칸) 크기 조절</button>
        <button class="pp_reset pp_danger" id="pp_del">이 글자 칸 삭제</button>`;
      $("pp_fs").oninput = () => { sel.style.fontSize = $("pp_fs").value + "px"; markDirty("text"); schedulePush(500); };
      $("pp_bold").onchange = () => { sel.style.fontWeight = $("pp_bold").checked ? "bold" : "normal"; markDirty("text"); pushHistory(); };
      $("pp_color").oninput = () => { sel.style.color = $("pp_color").value; markDirty("text"); schedulePush(500); };
      p.querySelectorAll(".palign button").forEach((b) => { b.onclick = () => { sel.style.textAlign = b.dataset.al; markDirty("text"); pushHistory(); }; });
      $("pp_box").onclick = () => selectBox(sel.parentElement);
      $("pp_del").onclick = deleteSel;
    } else if (selType === "box") {
      const sc = stageScale(); const rect = sel.getBoundingClientRect();
      const w = Math.round(rect.width / sc), h = Math.round(rect.height / sc);
      p.innerHTML = `<div class="ptitle">박스(칸) 크기</div>
        <label>너비 <input type="number" id="pp_bw" value="${w}" min="20" step="5"> px</label>
        <label>높이 <input type="number" id="pp_bh" value="${h}" min="20" step="5"> px</label>
        <button class="pp_reset" id="pp_up">▢ 상위 박스 선택</button>
        <button class="pp_reset" id="pp_breset">원래 크기로</button>
        <button class="pp_reset pp_danger" id="pp_del">이 박스 삭제</button>`;
      $("pp_bw").oninput = () => { sel.style.width = $("pp_bw").value + "px"; markDirty(); schedulePush(500); };
      $("pp_bh").oninput = () => { sel.style.height = $("pp_bh").value + "px"; markDirty(); schedulePush(500); };
      $("pp_up").onclick = () => selectBox(sel.parentElement);
      $("pp_breset").onclick = () => { sel.style.width = ""; sel.style.height = ""; markDirty(); pushHistory(); updateProp(); };
      $("pp_del").onclick = deleteSel;
    } else if (selType === "image") {
      const w = Math.round(curWidthStagePx(sel));
      const tx = Math.round(+sel.dataset.hretx || 0), ty = Math.round(+sel.dataset.hrety || 0);
      p.innerHTML = `<div class="ptitle">그림 속성</div>
        <label>너비 <input type="number" id="pp_w" value="${w}" min="20" step="5"> px</label>
        <label>좌우 <input type="number" id="pp_x" value="${tx}" step="5"> px</label>
        <label>상하 <input type="number" id="pp_y" value="${ty}" step="5"> px</label>
        <button class="pp_reset" id="pp_reset">원위치/원크기</button>
        <button class="pp_reset pp_danger" id="pp_del">이 그림 삭제</button>`;
      $("pp_w").oninput = () => { setImgWidth(sel, parseFloat($("pp_w").value) || 20); markDirty("image"); schedulePush(500); };
      $("pp_x").oninput = () => { sel.dataset.hretx = $("pp_x").value; applyTranslate(sel); markDirty("image"); schedulePush(500); };
      $("pp_y").oninput = () => { sel.dataset.hrety = $("pp_y").value; applyTranslate(sel); markDirty("image"); schedulePush(500); };
      $("pp_reset").onclick = () => $("resetSel").click();
      $("pp_del").onclick = deleteSel;
    }
    positionHandle();
  }

  // ---------- 글자 크기 ----------
  function changeFont(delta) {
    if (selType !== "text" || !sel) { toast("먼저 글자를 클릭해 선택하세요", true); return; }
    const cur = parseFloat(win.getComputedStyle(sel).fontSize) || 16;
    const next = Math.max(8, cur + delta);
    sel.style.fontSize = next.toFixed(1) + "px";
    markDirty("text"); pushHistory(); updateProp();
  }
  $("fontUp").onclick = () => changeFont(2);
  $("fontDown").onclick = () => changeFont(-2);

  // ---------- 그림 크기/이동 ----------
  function curWidthStagePx(img) {
    return img.getBoundingClientRect().width / stageScale();
  }
  // 덱 CSS 의 max-height:100%!important 등을 이기기 위해 important 로 강제
  function setImgWidth(img, wpx) {
    img.style.setProperty("max-width", "none", "important");
    img.style.setProperty("max-height", "none", "important");
    img.style.setProperty("height", "auto", "important");
    img.style.setProperty("width", Math.round(wpx) + "px", "important");
  }
  function resizeImg(factor) {
    if (selType !== "image" || !sel) { toast("먼저 그림을 클릭해 선택하세요", true); return; }
    setImgWidth(sel, curWidthStagePx(sel) * factor);
    markDirty("image"); pushHistory(); updateProp();
  }
  $("imgUp").onclick = () => resizeImg(1.08);
  $("imgDown").onclick = () => resizeImg(0.92);

  function applyTranslate(img) {
    const tx = +img.dataset.hretx || 0, ty = +img.dataset.hrety || 0;
    img.style.transform = (tx || ty) ? `translate(${tx}px, ${ty}px)` : "";
  }
  function nudge(img, dx, dy) {
    img.dataset.hretx = (+img.dataset.hretx || 0) + dx;
    img.dataset.hrety = (+img.dataset.hrety || 0) + dy;
    applyTranslate(img);
    markDirty("image"); schedulePush(500); updateProp();
  }

  $("resetSel").onclick = () => {
    if (!sel) { toast("선택된 요소가 없습니다", true); return; }
    if (selType === "image") {
      sel.style.width = ""; sel.style.height = ""; sel.style.maxWidth = ""; sel.style.maxHeight = "";
      sel.style.transform = ""; delete sel.dataset.hretx; delete sel.dataset.hrety;
    } else if (selType === "text") {
      sel.style.fontSize = "";
    } else if (selType === "box") {
      sel.style.width = ""; sel.style.height = "";
    }
    markDirty(); pushHistory(); updateProp();
    toast("원래대로 되돌렸습니다");
  };

  // 드래그 이동
  let drag = null;
  function onDocMouseDown(e) {
    if (!editMode || e.target.tagName !== "IMG") return;
    selectImage(e.target);
    const sc = stageScale();
    drag = { img: e.target, sx: e.clientX, sy: e.clientY,
             bx: +e.target.dataset.hretx || 0, by: +e.target.dataset.hrety || 0, sc };
    e.preventDefault(); e.stopPropagation();
    doc.addEventListener("mousemove", onDocMouseMove, true);
    doc.addEventListener("mouseup", onDocMouseUp, true);
  }
  function onDocMouseMove(e) {
    if (!drag) return;
    const dx = (e.clientX - drag.sx) / drag.sc, dy = (e.clientY - drag.sy) / drag.sc;
    drag.img.dataset.hretx = drag.bx + dx; drag.img.dataset.hrety = drag.by + dy;
    applyTranslate(drag.img);
    positionHandle();
  }
  function onDocMouseUp() {
    if (drag) { markDirty("image"); pushHistory(); }
    drag = null;
    doc.removeEventListener("mousemove", onDocMouseMove, true);
    doc.removeEventListener("mouseup", onDocMouseUp, true);
  }

  const NAV_KEYS = [" ", "Spacebar", "PageUp", "PageDown", "Home", "End", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"];
  function onDocKeyDown(e) {
    if (!editMode) return;
    const editingNow = !!(doc.activeElement && doc.activeElement.isContentEditable);
    // 이미지 선택 + 텍스트 편집 중 아님 → 화살표로 미세이동
    if (selType === "image" && sel && !editingNow) {
      const step = e.shiftKey ? 10 : 1;
      if (e.key === "ArrowLeft") { nudge(sel, -step, 0); e.preventDefault(); e.stopPropagation(); return; }
      if (e.key === "ArrowRight") { nudge(sel, step, 0); e.preventDefault(); e.stopPropagation(); return; }
      if (e.key === "ArrowUp") { nudge(sel, 0, -step); e.preventDefault(); e.stopPropagation(); return; }
      if (e.key === "ArrowDown") { nudge(sel, 0, step); e.preventDefault(); e.stopPropagation(); return; }
    }
    if (e.key === "Escape") { clearSelection(); return; }
    // 선택된 그림/박스 삭제 (텍스트 편집 중이면 패스 — 그땐 본문 글자 삭제)
    if (!editingNow && (selType === "image" || selType === "box") && (e.key === "Delete" || e.key === "Backspace")) {
      deleteSel(); e.preventDefault(); e.stopPropagation(); return;
    }
    // 덱 자체의 키보드 네비게이션(스페이스=다음장 등)이 편집을 방해하지 않게 차단.
    // 입력/캐럿 기본동작은 유지(텍스트 편집 중 스페이스는 그대로 입력).
    if (NAV_KEYS.includes(e.key)) {
      e.stopPropagation();
      if (!editingNow && (e.key === " " || e.key === "Spacebar" || e.key === "PageDown" || e.key === "PageUp")) e.preventDefault();
    }
  }

  // ---------- 이미지 교체 ----------
  const picker = $("imgPicker");
  $("replaceImg").onclick = () => {
    if (selType !== "image" || !sel) { toast("먼저 그림을 클릭해 선택하세요", true); return; }
    picker.click();
  };
  picker.addEventListener("change", async () => {
    const f = picker.files[0]; picker.value = "";
    if (!f || !sel) return;
    toast("이미지 처리 중...");
    try {
      const dataUrl = await downscale(f, 1100, 0.86);
      sel.src = dataUrl;
      sel.removeAttribute("srcset");
      // <picture><source srcset>] 안의 img 면, source 들이 남아 교체가 무시되므로 제거
      const pic = sel.closest("picture");
      if (pic) pic.querySelectorAll("source").forEach((s) => s.remove());
      markDirty("image"); pushHistory();
      toast("이미지를 바꿨습니다");
    } catch (err) { toast("이미지 처리 실패", true); }
  });

  function downscale(file, maxDim, quality) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        let { width: w, height: h } = img;
        const m = Math.max(w, h);
        if (m > maxDim) { const r = maxDim / m; w = Math.round(w * r); h = Math.round(h * r); }
        const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
        const ctx = cv.getContext("2d");
        ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        const hasAlpha = /png$/i.test(file.type);
        resolve(cv.toDataURL(hasAlpha ? "image/png" : "image/jpeg", quality));
      };
      img.onerror = reject;
      img.src = url;
    });
  }

  // ---------- 이미지 리사이즈 핸들 (부모 오버레이, PPT식 모서리 드래그) ----------
  const stageWrap = document.querySelector(".stage-wrap");
  const imgHandle = $("imgHandle");
  let hres = null;
  function positionHandle() {
    if (!editMode || selType !== "image" || !sel || document.body.classList.contains("presenting")) { imgHandle.hidden = true; return; }
    try {
      const ir = frame.getBoundingClientRect(), wr = stageWrap.getBoundingClientRect(), r = sel.getBoundingClientRect();
      imgHandle.style.left = (ir.left + r.right - wr.left) + "px";
      imgHandle.style.top = (ir.top + r.bottom - wr.top) + "px";
      imgHandle.hidden = false;
    } catch (e) { imgHandle.hidden = true; }
  }
  imgHandle.addEventListener("mousedown", (e) => {
    if (selType !== "image" || !sel) return;
    e.preventDefault(); e.stopPropagation();
    hres = { sx: e.clientX, base: curWidthStagePx(sel), sc: stageScale() };
    frame.style.pointerEvents = "none";  // 드래그 중 mousemove 가 iframe 으로 새지 않게
    document.addEventListener("mousemove", onHandleMove, true);
    document.addEventListener("mouseup", onHandleUp, true);
  });
  function onHandleMove(e) {
    if (!hres) return;
    setImgWidth(sel, Math.max(20, hres.base + (e.clientX - hres.sx) / hres.sc));
    positionHandle(); markDirty("image"); schedulePush(500);
  }
  function onHandleUp() {
    frame.style.pointerEvents = "";
    if (hres) { hres = null; pushHistory(); updateProp(); }
    document.removeEventListener("mousemove", onHandleMove, true);
    document.removeEventListener("mouseup", onHandleUp, true);
  }
  window.addEventListener("resize", positionHandle);

  // ---------- 발표 모드 (슬라이드만 전체화면) ----------
  function enterPresent() {
    if (editMode) $("modeBtn").click();   // 편집 끄기
    clearSelection();
    document.body.classList.add("presenting");
    $("presentExit").hidden = false;
    if (stageWrap.requestFullscreen) stageWrap.requestFullscreen().catch(() => {});
    setTimeout(() => { try { frame.contentWindow.focus(); frame.contentWindow.dispatchEvent(new Event("resize")); } catch (e) {} }, 160);
  }
  function exitPresent() {
    document.body.classList.remove("presenting");
    $("presentExit").hidden = true;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    setTimeout(() => { try { frame.contentWindow.dispatchEvent(new Event("resize")); } catch (e) {} }, 160);
  }
  $("presentBtn").onclick = enterPresent;
  $("presentExit").onclick = exitPresent;
  document.addEventListener("fullscreenchange", () => {
    if (!document.fullscreenElement && document.body.classList.contains("presenting")) exitPresent();
  });

  // ---------- 선택 요소 삭제 ----------
  function deleteSel() {
    if (!sel) { toast("삭제할 요소를 먼저 선택하세요", true); return; }
    const node = sel;
    clearSelection();
    node.remove();
    markDirty(); pushHistory();
    toast("삭제했습니다 — Ctrl+Z 로 복구");
  }

  // ---------- 클립보드 이미지 붙여넣기 (Ctrl+V) ----------
  function insertImageAt(dataUrl) {
    const slide = doc.querySelector(".slide.active") || doc.querySelector(".slide");
    if (!slide) { toast("슬라이드를 찾지 못했습니다", true); return null; }
    const img = doc.createElement("img");
    img.src = dataUrl;
    // 무대(1600x900) 좌표계로 가운데쯤에 절대배치 — 이후 드래그/핸들로 이동·크기
    img.style.position = "absolute";
    img.style.left = "600px"; img.style.top = "300px";
    img.style.width = "320px"; img.style.height = "auto";
    img.style.zIndex = "20";
    slide.appendChild(img);
    selectImage(img); markDirty("image"); pushHistory(); positionHandle();
    return img;
  }
  async function handlePaste(e) {
    if (!editMode) return;
    const cd = e.clipboardData; if (!cd || !cd.items) return;
    const item = [...cd.items].find((it) => it.type && it.type.startsWith("image/"));
    if (!item) return;
    e.preventDefault(); e.stopPropagation();
    const file = item.getAsFile(); if (!file) return;
    try {
      const dataUrl = await downscale(file, 1100, 0.86);
      insertImageAt(dataUrl);
      toast("이미지 붙여넣음 — 드래그로 옮기세요");
    } catch (err) { toast("이미지 붙여넣기 실패", true); }
  }
  document.addEventListener("paste", handlePaste, true);
  // 외부(테스트 등)에서 호출 가능하게 노출
  window.HRE.insertImage = (dataUrl) => insertImageAt(dataUrl);
  window.HRE.deleteSelection = deleteSel;

  // ---------- PDF 내보내기 (클라이언트 인쇄, 서버 부하 0) ----------
  function fitSlideForPrint(s) {
    const f = s.querySelector(".fit"); if (!f) return null;
    const prev = f.style.transform;
    f.style.transform = "none";
    const body = f.parentElement, cs = win.getComputedStyle(body);
    const availH = body.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    const availW = body.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const k = Math.min(1, availH / f.scrollHeight, availW / f.scrollWidth);
    if (isFinite(k) && k < 1 && k > 0) { f.style.transformOrigin = "top left"; f.style.transform = "scale(" + k + ")"; }
    return { f, prev };
  }
  function exportPdf() {
    if (!doc) return;
    if (!doc.getElementById("hre-print-css")) {
      const l = doc.createElement("link");
      l.id = "hre-print-css"; l.rel = "stylesheet"; l.media = "print";
      l.href = "/static/print.css"; l.setAttribute("data-hre", "1");
      doc.head.appendChild(l);
    }
    // 모든 슬라이드를 각자 영역에 맞게 fit (인쇄 시 활성 슬라이드만 fit 되던 문제 방지). 인쇄 후 복원.
    const restore = [];
    doc.querySelectorAll(".slide").forEach((s) => { const r = fitSlideForPrint(s); if (r) restore.push(r); });
    const cleanup = () => { restore.forEach(({ f, prev }) => { f.style.transform = prev; }); win.removeEventListener("afterprint", cleanup); };
    win.addEventListener("afterprint", cleanup);
    toast("인쇄창에서 '대상'을 'PDF로 저장' 으로 선택하세요");
    setTimeout(() => { try { win.focus(); win.print(); } catch (e) { toast("인쇄창을 열지 못했습니다", true); cleanup(); } }, 200);
  }
  $("pdfBtn").onclick = exportPdf;

  // ---------- 저장 ----------
  async function save(silent) {
    if (!loggedIn) { toast("목록 화면에서 로그인 후 저장하세요", true); return; }
    if (!doc || saving) return;
    saving = true;
    flushPending();
    const seqAtSave = editSeq;  // 저장 중 추가 편집 감지용
    // 라이브 DOM 은 건드리지 않고(편집 중 커서 보존), 클론에서만 에디터 흔적 제거
    const clone = doc.documentElement.cloneNode(true);
    clone.querySelectorAll("[contenteditable]").forEach((e) => e.removeAttribute("contenteditable"));
    clone.querySelectorAll(".hre-sel,.hre-sel-img,.hre-sel-box").forEach((e) => e.classList.remove("hre-sel", "hre-sel-img", "hre-sel-box"));
    clone.querySelectorAll("[data-hre]").forEach((e) => e.remove());
    const body = clone.querySelector("body"); if (body) body.classList.remove("hre-edit");
    // dataset.hretx/hrety 정리
    clone.querySelectorAll("[data-hretx],[data-hrety]").forEach((e) => {
      e.removeAttribute("data-hretx"); e.removeAttribute("data-hrety");
    });
    const html = "<!DOCTYPE html>\n" + clone.outerHTML;

    if (!silent) {
      // 수동 저장 시 변경 요약 안내
      const parts = [];
      if (changeCount.text) parts.push(`${changeCount.text}개 글자 수정`);
      if (changeCount.image) parts.push(`${changeCount.image}개 그림 변경`);
      if (parts.length) toast("저장: " + parts.join(", "));
    }
    $("saveBtn").disabled = true; $("saveBtn").textContent = "저장 중...";
    setStatus("저장 중...");
    try {
      const r = await fetch(`/api/decks/${deckId}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ html }),
      });
      const j = await r.json();
      if (!r.ok) { setStatus("저장 실패", "dirty"); if (!silent) toast(j.error || "저장 실패", true); }
      else if (editSeq === seqAtSave) {
        // 저장 동안 추가 편집 없었을 때만 clean 처리
        dirty = false; changeCount = { text: 0, image: 0 };
        setStatus((silent ? "자동저장됨 " : "저장됨 ") + hhmm() + " KST", "saved");
        if (j.title) $("etitle").textContent = j.title;
        if (!silent) toast("저장했습니다");
      } else {
        // 저장 중 추가 변경 발생 → dirty 유지(다음 자동저장이 잡음)
        setStatus("저장됨 " + hhmm() + " KST · 이후 추가 변경", "dirty");
        if (j.title) $("etitle").textContent = j.title;
        if (!silent) toast("저장했습니다 (이후 변경분은 다음 저장에)");
      }
    } catch (e) { setStatus("저장 오류", "dirty"); if (!silent) toast("저장 중 오류", true); }
    saving = false;
    $("saveBtn").disabled = false; $("saveBtn").textContent = "저장";
  }
  $("saveBtn").onclick = () => save(false);

  // 단축키 (부모 문서 포커스 기준): 저장 / undo / redo
  document.addEventListener("keydown", (e) => {
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === "s") { e.preventDefault(); save(false); }
    else if ((e.ctrlKey || e.metaKey) && k === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
    else if ((e.ctrlKey || e.metaKey) && (k === "y" || (k === "z" && e.shiftKey))) { e.preventDefault(); redo(); }
  });
})();
