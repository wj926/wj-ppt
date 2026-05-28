// html-revise 목록/업로드/로그인 페이지
const $ = (s) => document.querySelector(s);

function toast(msg, isErr) {
  let t = $("#toast");
  if (!t) { t = document.createElement("div"); t.id = "toast"; t.className = "toast"; document.body.appendChild(t); }
  t.textContent = msg;
  t.className = "toast show" + (isErr ? " err" : "");
  clearTimeout(t._h);
  t._h = setTimeout(() => { t.className = "toast"; }, 2600);
}

let currentUser = "anon";

async function refreshUser() {
  // 로그인 비활성화: 업로드 항상 노출, 로그인 UI 숨김
  $("#userbox").innerHTML = "";
  $("#loginCard").hidden = true;
  $("#uploadCard").hidden = false;
}

function esc(s) { return (s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

// ---- 로그인 ----
$("#loginBtn").onclick = async () => {
  const name = $("#loginName").value.trim();
  const key = $("#loginKey").value;
  $("#loginErr").textContent = "";
  const r = await fetch("/api/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, key }),
  });
  const j = await r.json();
  if (!r.ok) { $("#loginErr").textContent = j.error || "로그인 실패"; return; }
  toast("로그인되었습니다");
  refreshUser();
};
$("#loginKey").addEventListener("keydown", (e) => { if (e.key === "Enter") $("#loginBtn").click(); });

// ---- 업로드 ----
const drop = $("#drop"), fileInput = $("#fileInput");
$("#pickBtn").onclick = (e) => { e.stopPropagation(); fileInput.click(); };
drop.onclick = () => fileInput.click();
drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
drop.addEventListener("dragleave", () => drop.classList.remove("over"));
drop.addEventListener("drop", (e) => {
  e.preventDefault(); drop.classList.remove("over");
  if (e.dataTransfer.files[0]) uploadFile(e.dataTransfer.files[0]);
});
fileInput.addEventListener("change", () => { if (fileInput.files[0]) uploadFile(fileInput.files[0]); });

function scanExternal(html) {
  // data: 가 아닌 외부 리소스(http(s):// 또는 //cdn) 를 구조적으로 검사
  const urls = new Set();
  const isExt = (v) => v && /^(?:https?:)?\/\//i.test(v.trim());
  try {
    const d = new DOMParser().parseFromString(html, "text/html");
    d.querySelectorAll("[src],[href],[srcset]").forEach((el) => {
      ["src", "href"].forEach((a) => { const v = el.getAttribute(a); if (isExt(v)) urls.add(v.trim()); });
      const ss = el.getAttribute("srcset");
      if (ss) ss.split(",").forEach((p) => { const u = p.trim().split(/\s+/)[0]; if (isExt(u)) urls.add(u); });
    });
    let styleText = [...d.querySelectorAll("style")].map((s) => s.textContent).join("\n");
    styleText += " " + [...d.querySelectorAll("[style]")].map((e) => e.getAttribute("style")).join("\n");
    const re = /url\(\s*['"]?((?:https?:)?\/\/[^'")]+)/gi; let m;
    while ((m = re.exec(styleText))) urls.add(m[1]);
    if (/@import\s+(?:url\()?["']?(?:https?:)?\/\//i.test(styleText)) urls.add("(css @import)");
  } catch (e) {
    const re = /(?:src|href)\s*=\s*["']\s*(https?:\/\/[^"']+)/gi; let m;
    while ((m = re.exec(html))) urls.add(m[1]);
  }
  return [...urls];
}

async function uploadFile(file) {
  $("#uploadErr").textContent = "";
  if (!/\.html?$/i.test(file.name)) { $("#uploadErr").textContent = "HTML 파일만 올릴 수 있습니다."; return; }
  // 업로드 전 검사: 외부 리소스가 있으면 경고 (self-contained 권장)
  try {
    const text = await file.text();
    const ext = scanExternal(text);
    if (ext.length > 0) {
      const ok = confirm(`외부 리소스 ${ext.length}개가 포함되어 있습니다.\n이미지/CSS/스크립트가 외부 링크라면 다운로드·공유 시 깨질 수 있습니다.\n(권장: 이미지가 인라인된 self-contained HTML)\n\n그래도 올릴까요?`);
      if (!ok) { $("#uploadErr").textContent = `업로드 취소됨 — 외부 리소스 ${ext.length}개 발견.`; return; }
    }
  } catch (e) { /* 파일 읽기 실패 시 그냥 진행 */ }
  const fd = new FormData();
  fd.append("file", file);
  toast("업로드 중...");
  const r = await fetch("/api/decks", { method: "POST", body: fd });
  const j = await r.json();
  if (!r.ok) { $("#uploadErr").textContent = j.error || "업로드 실패"; return; }
  toast("올렸습니다. 편집기로 이동합니다.");
  location.href = `/editor/${j.deck_id}`;
}

// ---- 목록 ----
async function loadDecks() {
  const r = await fetch("/api/decks");
  const decks = await r.json();
  const grid = $("#deckGrid");
  if (!decks.length) { grid.innerHTML = `<div class="empty">아직 올린 슬라이드가 없습니다.</div>`; return; }
  grid.innerHTML = decks.map((d) => `
    <div class="deck">
      <div class="dtitle">${esc(d.title || "제목 없음")}</div>
      <div class="dmeta">${d.owner ? esc(d.owner) + " · " : ""}수정 ${fmt(d.updated)}</div>
      <div class="dacts">
        <a class="btn sm" href="/editor/${d.deck_id}">편집</a>
        <a class="btn ghost sm" href="/download/${d.deck_id}">다운로드</a>
        <button class="btn danger sm" data-del="${d.deck_id}">삭제</button>
      </div>
    </div>`).join("");
  grid.querySelectorAll("[data-del]").forEach((b) => {
    b.onclick = async () => {
      if (!currentUser) { toast("로그인이 필요합니다", true); return; }
      if (!confirm("이 슬라이드를 삭제할까요?")) return;
      const rr = await fetch(`/api/decks/${b.dataset.del}`, { method: "DELETE" });
      if (rr.ok) { toast("삭제했습니다"); loadDecks(); } else { toast("삭제 실패", true); }
    };
  });
}

function fmt(iso) {
  if (!iso) return "-";
  // 저장은 UTC(2026-05-27T12-31-40Z). 표준화 후 한국시간(KST)으로 표시.
  const norm = iso.replace(/(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})Z?/, "$1T$2:$3:$4Z");
  const d = new Date(norm);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }) + " KST";
}

refreshUser();
loadDecks();
