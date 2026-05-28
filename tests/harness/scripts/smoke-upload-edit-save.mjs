import { newBrowser, writeReport, summarize } from "../lib/core.mjs";
import { checkUploadEditSave } from "../lib/checks.mjs";
const b = await newBrowser(); const ctx = await b.newContext();
const sec = await checkUploadEditSave(ctx);
const s = summarize(sec.results);
sec.results.forEach((r) => console.log((r.pass ? "PASS" : "FAIL") + " | " + r.name + (r.info ? " | " + r.info : "")));
console.log(`\n업로드-편집-저장: ${s.pass}/${s.total}`);
writeReport("smoke-upload-edit-save", [{ title: sec.title, results: sec.results }], sec.errs || []);
await b.close(); process.exit(s.fail ? 1 : 0);
