import { newBrowser, writeReport, summarize } from "../lib/core.mjs";
import { checkMobileLayout } from "../lib/checks.mjs";
const b = await newBrowser(); const ctx = await b.newContext();
const sec = await checkMobileLayout(ctx);
const s = summarize(sec.results);
sec.results.forEach((r) => console.log((r.pass ? "PASS" : "FAIL") + " | " + r.name + (r.info ? " | " + r.info : "")));
console.log(`\n모바일 레이아웃: ${s.pass}/${s.total}`);
writeReport("check-mobile-layout", [{ title: sec.title, results: sec.results }], sec.errs || []);
await b.close(); process.exit(s.fail ? 1 : 0);
