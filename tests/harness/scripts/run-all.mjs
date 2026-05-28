// 전체 하네스 실행: 홈 -> 업로드/편집/저장 -> 멀티슬라이드 -> 모바일 -> 리포트.
// 하나 실패해도 다음 계속 진행, 마지막에 실패 모아 exit 1.
import { newBrowser, maybeLogin, cleanupHarnessDecks, writeReport, summarize } from "../lib/core.mjs";
import { checkHome, checkUploadEditSave, checkMultislide, checkPageNav, checkUndoRedo, checkPropPanel, checkEditingFixes, checkResizeHandle, checkPresentMode, checkPasteAndDelete, checkPdfExport, checkImagePersist, checkUploadPrecheck, checkMobileLayout } from "../lib/checks.mjs";

const STEPS = [
  ["home", checkHome],
  ["upload-edit-save", checkUploadEditSave],
  ["multislide", checkMultislide],
  ["page-nav", checkPageNav],
  ["undo-redo", checkUndoRedo],
  ["prop-panel", checkPropPanel],
  ["editing-fixes", checkEditingFixes],
  ["resize-handle", checkResizeHandle],
  ["present-mode", checkPresentMode],
  ["paste-delete", checkPasteAndDelete],
  ["pdf-export", checkPdfExport],
  ["image-persist", checkImagePersist],
  ["upload-precheck", checkUploadPrecheck],
  ["mobile-layout", checkMobileLayout],
];

const browser = await newBrowser();
const ctx = await browser.newContext();
const page = await ctx.newPage();
const who = await maybeLogin(page); await page.close();
console.log("auth:", who);

const sections = []; const errs = [];
for (const [name, fn] of STEPS) {
  process.stdout.write(`\n[${name}] ...`);
  try {
    const sec = await fn(ctx);
    sections.push({ title: sec.title, results: sec.results });
    if (sec.errs) errs.push(...sec.errs);
    const s = summarize(sec.results);
    console.log(` ${s.pass}/${s.total} pass`);
    sec.results.filter((r) => !r.pass).forEach((r) => console.log(`   FAIL: ${r.name} | ${r.info || ""}`));
  } catch (e) {
    sections.push({ title: name, results: [{ name: "실행 예외", pass: false, info: e.message }] });
    console.log(" 예외:", e.message);
  }
}

const cleaned = await cleanupHarnessDecks();
console.log(`\nHARNESS_TEST_ deck 정리: ${cleaned}개`);

const { file, sum } = writeReport("run-all", sections, errs);
console.log(`\n===== 총 ${sum.total} · PASS ${sum.pass} · FAIL ${sum.fail} =====`);
console.log("리포트:", file);
await browser.close();
process.exit(sum.fail ? 1 : 0);
