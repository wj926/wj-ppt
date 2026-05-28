// HTML Revise 작업 하네스 공통 모듈 — 브라우저 구동, 픽스처 업로드, 검증 함수, 리포트.
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
let pw;
try { pw = require(process.env.PLAYWRIGHT_CORE || "playwright-core"); }
catch { pw = require("/home/dami/wj/temp_works/0528_서울대세미나/node_modules/playwright-core"); }
const { chromium } = pw;
const CHROME_BIN = process.env.CHROME_BIN || "/usr/bin/google-chrome";

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(HERE, "..");
export const FIX = join(ROOT, "fixtures");
export const SHOTS = join(ROOT, "screenshots");
export const REPORTS = join(ROOT, "reports");
mkdirSync(SHOTS, { recursive: true });
mkdirSync(REPORTS, { recursive: true });

export const BASE = process.env.HTML_REVISE_BASE_URL || "http://localhost:3007";
export const SHARED_KEY = process.env.HTML_REVISE_SHARED_KEY || "";
export const USER_NAME = process.env.HTML_REVISE_USER_NAME || "HARNESS봇";
const PREFIX = "HARNESS_TEST_";

export async function newBrowser() {
  const browser = await chromium.launch({ headless: true, executablePath: CHROME_BIN, args: ["--disable-gpu"] });
  return browser;
}

// 콘솔/페이지 에러를 모으는 페이지 래퍼
export function trackErrors(page) {
  const errs = [];
  page.on("console", (m) => { if (m.type() === "error") errs.push("console: " + m.text()); });
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  return errs;
}

// 로그인(있을 때만). 현재 운영은 로그인 비활성 — 키 있으면 시도, 없으면 skip.
export async function maybeLogin(page) {
  if (!SHARED_KEY) return "anon(login-disabled)";
  await page.goto(BASE + "/", { waitUntil: "load" });
  const ok = await page.evaluate(async ({ name, key }) => {
    const r = await fetch("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, key }) });
    return r.ok;
  }, { name: USER_NAME, key: SHARED_KEY });
  return ok ? USER_NAME : "login-failed";
}

// 픽스처를 업로드(제목 prefix 강제) → deck_id
export async function uploadFixture(fixtureName) {
  const path = join(FIX, fixtureName);
  const buf = readFileSync(path);
  const fd = new FormData();
  fd.append("file", new Blob([buf], { type: "text/html" }), PREFIX + fixtureName);
  const r = await fetch(BASE + "/api/decks", { method: "POST", body: fd });
  if (!r.ok) throw new Error("업로드 실패 " + r.status + " " + fixtureName);
  return (await r.json()).deck_id;
}

export async function fetchText(path) {
  const r = await fetch(BASE + path);
  return { status: r.status, text: await r.text() };
}

// HARNESS_TEST_ prefix deck 만 정리 (운영 deck 보호)
export async function cleanupHarnessDecks() {
  const r = await fetch(BASE + "/api/decks");
  const decks = await r.json();
  let n = 0;
  for (const d of decks) {
    if ((d.orig_name || "").startsWith(PREFIX) || (d.title || "").includes(PREFIX)) {
      await fetch(BASE + "/api/decks/" + d.deck_id, { method: "DELETE" }); n++;
    }
  }
  return n;
}

// 결과 누적기
export function makeReport() {
  const results = [];
  return {
    ok(name, cond, info = "") { results.push({ name, pass: !!cond, info }); return !!cond; },
    add(name, pass, info = "") { results.push({ name, pass, info }); },
    results,
  };
}

export function summarize(results) {
  const fail = results.filter((r) => !r.pass).length;
  return { total: results.length, fail, pass: results.length - fail };
}

export function writeReport(name, sections, errs = []) {
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const file = join(REPORTS, `${ts}_${name}.md`);
  let all = [];
  let md = `# HTML Revise 하네스 리포트 — ${name}\n\n- 실행: ${new Date().toISOString()}\n- 대상: ${BASE}\n\n`;
  for (const s of sections) {
    md += `## ${s.title}\n\n`;
    for (const r of s.results) {
      md += `- ${r.pass ? "PASS" : "**FAIL**"} | ${r.name}${r.info ? " | " + r.info : ""}\n`;
      all.push(r);
    }
    md += "\n";
  }
  const sum = summarize(all);
  md += `## 요약\n\n총 ${sum.total}건 · PASS ${sum.pass} · FAIL ${sum.fail}\n`;
  if (errs.length) md += `\n## 콘솔/페이지 에러\n\n` + errs.slice(0, 30).map((e) => "- " + e).join("\n") + "\n";
  writeFileSync(file, md);
  return { file, sum };
}
