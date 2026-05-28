// 개별 검증 함수들. 각 함수는 {title, results, errs, shots} 반환.
import { BASE, trackErrors, uploadFixture, fetchText, SHOTS, FIX } from "./core.mjs";
import { join } from "path";

async function measureNoHScroll(page) {
  return await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth,
  }));
}
async function openEditor(ctx, deckId) {
  const page = await ctx.newPage();
  const errs = trackErrors(page);
  await page.goto(BASE + "/editor/" + deckId, { waitUntil: "load" });
  await page.waitForTimeout(1200);
  return { page, errs };
}

export async function checkHome(ctx) {
  const r = []; const page = await ctx.newPage(); const errs = trackErrors(page);
  const resp = await page.goto(BASE + "/", { waitUntil: "load" });
  r.push({ name: "홈 200", pass: resp.status() === 200, info: "status=" + resp.status() });
  await page.waitForTimeout(400);
  r.push({ name: "업로드 카드 표시", pass: await page.locator("#uploadCard").isVisible() });
  r.push({ name: "목록 영역 존재", pass: (await page.locator("#deckGrid").count()) > 0 });
  await page.setViewportSize({ width: 1440, height: 900 }); await page.waitForTimeout(200);
  let m = await measureNoHScroll(page);
  r.push({ name: "데스크톱 1440 가로스크롤 없음", pass: m.sw <= m.cw + 1, info: `sw=${m.sw} cw=${m.cw}` });
  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(200);
  m = await measureNoHScroll(page);
  r.push({ name: "모바일 390 가로스크롤 없음", pass: m.sw <= m.cw + 1, info: `sw=${m.sw} cw=${m.cw}` });
  r.push({ name: "콘솔 에러 없음", pass: errs.length === 0, info: errs.join("; ") });
  await page.close();
  return { title: "홈 화면 스모크", results: r, errs };
}

export async function checkUploadEditSave(ctx) {
  const r = []; const errs0 = [];
  const id = await uploadFixture("simple-slide.html");
  r.push({ name: "업로드 성공", pass: !!id, info: "deck=" + id });
  const { page, errs } = await openEditor(ctx, id);
  const fl = page.frameLocator("#frame");
  r.push({ name: "iframe 슬라이드 로드", pass: (await fl.locator(".slide").count()) > 0 });
  await page.click("#modeBtn"); await page.waitForTimeout(300);
  r.push({ name: "편집 컨트롤 표시", pass: await page.locator("#editControls").isVisible() });

  const marker = "HARNESS수정_" + Date.now();
  const li = fl.locator(".slide.active li").first();
  await li.click(); await page.waitForTimeout(150);
  r.push({ name: "텍스트 클릭->contenteditable", pass: (await li.getAttribute("contenteditable")) === "true" });
  const f0 = await li.evaluate((e) => e.style.fontSize || "");
  await page.click("#fontUp");
  const f1 = await li.evaluate((e) => e.style.fontSize || "");
  r.push({ name: "글씨 A+ 적용", pass: f0 !== f1, info: `${f0}->${f1}` });
  await li.evaluate((e, t) => { e.textContent = t; }, marker);

  const img = fl.locator(".slide.active img").first();
  await img.click(); await page.waitForTimeout(120);
  await page.click("#imgUp"); await page.waitForTimeout(120);
  const w = await img.evaluate((e) => e.style.width || "");
  r.push({ name: "그림 ＋크기 적용", pass: w !== "", info: "width=" + w });

  const putP = page.waitForResponse((rr) => rr.url().includes("/api/decks/" + id) && rr.request().method() === "PUT");
  await page.click("#saveBtn");
  const put = await putP;
  r.push({ name: "저장 PUT 200", pass: put.status() === 200, info: "status=" + put.status() });
  await page.waitForTimeout(300);

  const raw = await fetchText("/raw/" + id);
  r.push({ name: "저장본에 수정 텍스트", pass: raw.text.includes(marker) });
  r.push({ name: "contenteditable 미잔류", pass: !raw.text.includes('contenteditable="true"') });
  r.push({ name: "hre-sel 미잔류", pass: !raw.text.includes("hre-sel") });
  r.push({ name: "hre-style 미잔류", pass: !raw.text.includes("hre-style") });
  r.push({ name: "data-hre 미잔류", pass: !raw.text.includes("data-hre") });
  r.push({ name: "data-hretx 미잔류", pass: !raw.text.includes("data-hretx") });
  const dl = await fetchText("/download/" + id);
  r.push({ name: "다운로드 200 + 수정 반영", pass: dl.status === 200 && dl.text.includes(marker), info: "status=" + dl.status });
  await page.close();
  return { title: "업로드-편집-저장-다운로드 E2E + 클린업", results: r, errs };
}

export async function checkMultislide(ctx) {
  const r = [];
  const id = await uploadFixture("multi-slide.html");
  const { page, errs } = await openEditor(ctx, id);
  const ind = () => page.locator("#pageInd").textContent();
  r.push({ name: "초기 인디케이터 1 / 4", pass: (await ind()).trim() === "1 / 4", info: await ind() });
  await page.click("#nextBtn"); await page.waitForTimeout(200);
  r.push({ name: "다음 -> 2 / 4", pass: (await ind()).trim() === "2 / 4", info: await ind() });
  await page.click("#prevBtn"); await page.waitForTimeout(200);
  r.push({ name: "이전 -> 1 / 4", pass: (await ind()).trim() === "1 / 4", info: await ind() });
  await page.click("#prevBtn"); await page.waitForTimeout(200);
  r.push({ name: "첫 페이지서 이전 눌러도 1 / 4", pass: (await ind()).trim() === "1 / 4", info: await ind() });
  for (let k = 0; k < 6; k++) { await page.click("#nextBtn"); await page.waitForTimeout(80); }
  r.push({ name: "마지막서 다음 눌러도 4 / 4", pass: (await ind()).trim() === "4 / 4", info: await ind() });
  await page.close();
  return { title: "멀티 슬라이드 네비게이션", results: r, errs };
}

export async function checkPageNav(ctx) {
  const r = [];
  const id = await uploadFixture("multi-slide.html");
  const { page, errs } = await openEditor(ctx, id);
  const ind = () => page.locator("#pageInd").textContent();
  // 목차 레일
  await page.click("#railBtn"); await page.waitForTimeout(250);
  r.push({ name: "목차 레일 표시", pass: await page.locator("#railPanel").isVisible() });
  const items = await page.locator(".railitem").count();
  r.push({ name: "레일 항목 수 = 4", pass: items === 4, info: "items=" + items });
  await page.locator('.railitem[data-n="3"]').click(); await page.waitForTimeout(250);
  r.push({ name: "레일 클릭 -> 3 / 4", pass: (await ind()).trim() === "3 / 4", info: await ind() });
  r.push({ name: "레일 현재항목 하이라이트", pass: await page.locator('.railitem[data-n="3"]').evaluate((e) => e.classList.contains("on")) });
  // 페이지 번호 직접 이동 (prompt)
  page.once("dialog", (d) => d.accept("2"));
  await page.click("#pageInd"); await page.waitForTimeout(300);
  r.push({ name: "번호 입력 -> 2 / 4", pass: (await ind()).trim() === "2 / 4", info: await ind() });
  await page.close();
  return { title: "페이지 직접이동 + 목차 레일", results: r, errs };
}

export async function checkUndoRedo(ctx) {
  const r = [];
  const id = await uploadFixture("simple-slide.html");
  const { page, errs } = await openEditor(ctx, id);
  const fl = page.frameLocator("#frame");
  await page.click("#modeBtn"); await page.waitForTimeout(300);
  const li = fl.locator(".slide.active li").first();
  const orig = (await li.textContent()).trim();
  await li.click(); await page.waitForTimeout(150);
  const marker = "UNDO마커_" + Date.now();
  await li.evaluate((e, t) => { e.textContent = t; e.dispatchEvent(new InputEvent("input", { bubbles: true })); }, marker);
  await page.waitForTimeout(900);  // schedulePush(700) 발화 대기
  r.push({ name: "편집 후 상태=수정됨", pass: /수정/.test(await page.locator("#saveStatus").textContent()) });
  r.push({ name: "undo 버튼 활성", pass: !(await page.locator("#undoBtn").isDisabled()) });
  await page.click("#undoBtn"); await page.waitForTimeout(250);
  const afterUndo = (await fl.locator(".slide.active li").first().textContent()).trim();
  r.push({ name: "undo -> 원래 텍스트 복원", pass: afterUndo === orig, info: `"${afterUndo}" == "${orig}"` });
  await page.click("#redoBtn"); await page.waitForTimeout(250);
  const afterRedo = (await fl.locator(".slide.active li").first().textContent()).trim();
  r.push({ name: "redo -> 수정 텍스트 복귀", pass: afterRedo === marker, info: `"${afterRedo}"` });
  // 수동 저장 후 상태=저장됨
  const putP = page.waitForResponse((rr) => rr.url().includes("/api/decks/" + id) && rr.request().method() === "PUT");
  await page.click("#saveBtn"); await putP; await page.waitForTimeout(200);
  r.push({ name: "저장 후 상태=저장됨", pass: /저장됨/.test(await page.locator("#saveStatus").textContent()) });
  await page.close();
  return { title: "undo/redo + 자동저장 상태", results: r, errs };
}

export async function checkEditingFixes(ctx) {
  const r = [];
  // 1) 스페이스바가 편집 모드에서 슬라이드를 넘기지 않음
  const idM = await uploadFixture("multi-slide.html");
  let { page, errs } = await openEditor(ctx, idM);
  await page.click("#modeBtn"); await page.waitForTimeout(250);
  const before = (await page.locator("#pageInd").textContent()).trim();
  await page.evaluate(() => {
    const d = document.querySelector("#frame").contentDocument;
    d.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true }));
  });
  await page.waitForTimeout(200);
  const after = (await page.locator("#pageInd").textContent()).trim();
  r.push({ name: "편집모드 스페이스바 슬라이드 안 넘어감", pass: before === after, info: `${before} -> ${after}` });
  await page.close();

  // 2) 일반 텍스트(클래스 무관, 제목 h1)도 편집 가능 + 박스 크기 조절
  const idS = await uploadFixture("simple-slide.html");
  ({ page, errs } = await openEditor(ctx, idS));
  const fl = page.frameLocator("#frame");
  await page.click("#modeBtn"); await page.waitForTimeout(250);
  const h1 = fl.locator(".slide.active h1").first();
  await h1.click(); await page.waitForTimeout(150);
  r.push({ name: "제목 h1 텍스트 편집 가능", pass: (await h1.getAttribute("contenteditable")) === "true" });
  // 박스 크기: li 선택 -> 박스 버튼 -> 너비 조절
  const li = fl.locator(".slide.active li").first();
  await li.click(); await page.waitForTimeout(150);
  await page.click("#pp_box"); await page.waitForTimeout(200);
  r.push({ name: "박스 선택 -> 너비 필드 표시", pass: (await page.locator("#pp_bw").count()) > 0 });
  await page.fill("#pp_bw", "500"); await page.dispatchEvent("#pp_bw", "input"); await page.waitForTimeout(200);
  const boxW = await fl.locator(".hre-sel-box").first().evaluate((e) => e.style.width);
  r.push({ name: "박스 너비 적용", pass: boxW === "500px", info: boxW });
  await page.close();

  // 3) 제목(프로젝트명) 변경 + 영속
  const idR = await uploadFixture("simple-slide.html");
  ({ page, errs } = await openEditor(ctx, idR));
  const newName = "프로젝트새이름_" + Date.now();
  page.once("dialog", (d) => d.accept(newName));
  await page.click("#etitle"); await page.waitForTimeout(400);
  r.push({ name: "제목 변경 즉시 반영", pass: (await page.locator("#etitle").textContent()).trim() === newName });
  const meta = await (await fetch(BASE + "/api/decks/" + idR)).json();
  r.push({ name: "제목 변경 서버 영속", pass: meta.title === newName, info: meta.title });
  // 저장해도 사용자 제목 유지
  const putP = page.waitForResponse((rr) => rr.url().includes("/api/decks/" + idR) && rr.request().method() === "PUT");
  await page.click("#saveBtn"); const put = await putP; const pj = await put.json();
  r.push({ name: "저장 후에도 사용자 제목 유지", pass: pj.title === newName, info: pj.title });
  await page.close();
  return { title: "편집 수정사항(스페이스/일반텍스트/박스/제목)", results: r, errs };
}

export async function checkResizeHandle(ctx) {
  const r = [];
  const id = await uploadFixture("image-heavy-slide.html");
  const { page, errs } = await openEditor(ctx, id);
  const fl = page.frameLocator("#frame");
  await page.click("#modeBtn"); await page.waitForTimeout(250);
  const img = fl.locator(".slide.active img").first();
  await img.click(); await page.waitForTimeout(250);
  r.push({ name: "이미지 선택 시 리사이즈 핸들 표시", pass: await page.locator("#imgHandle").isVisible() });
  const w0 = await img.evaluate((e) => e.getBoundingClientRect().width);
  const box = await page.locator("#imgHandle").boundingBox();
  if (box) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 120, box.y + 80, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(250);
  }
  const w1 = await img.evaluate((e) => e.getBoundingClientRect().width);
  r.push({ name: "핸들 드래그로 너비 증가", pass: w1 > w0 + 5, info: `${Math.round(w0)} -> ${Math.round(w1)}` });
  await page.close();
  return { title: "이미지 모서리 드래그 리사이즈", results: r, errs };
}

export async function checkPresentMode(ctx) {
  const r = [];
  const id = await uploadFixture("simple-slide.html");
  const { page, errs } = await openEditor(ctx, id);
  await page.click("#presentBtn"); await page.waitForTimeout(350);
  r.push({ name: "발표모드 진입(class)", pass: await page.evaluate(() => document.body.classList.contains("presenting")) });
  r.push({ name: "발표모드 툴바 숨김", pass: !(await page.locator(".ebar").isVisible()) });
  r.push({ name: "발표 종료 버튼 표시", pass: await page.locator("#presentExit").isVisible() });
  await page.click("#presentExit"); await page.waitForTimeout(350);
  r.push({ name: "발표 종료 후 복귀", pass: !(await page.evaluate(() => document.body.classList.contains("presenting"))) });
  r.push({ name: "복귀 후 툴바 표시", pass: await page.locator(".ebar").isVisible() });
  await page.close();
  return { title: "발표 모드", results: r, errs };
}

export async function checkPasteAndDelete(ctx) {
  const r = [];
  const id = await uploadFixture("simple-slide.html");
  const { page, errs } = await openEditor(ctx, id);
  const fl = page.frameLocator("#frame");
  await page.click("#modeBtn"); await page.waitForTimeout(250);

  // 1) 클립보드 붙여넣기 (HRE.insertImage 경유 — 동일 로직)
  const dataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAQAAAAmkwkpAAAAEUlEQVR42mP8z8BQz4AEGAEAUAUC/EW9NwAAAABJRU5ErkJggg==";
  const imgBefore = await fl.locator(".slide.active img").count();
  await page.evaluate((u) => window.HRE.insertImage(u), dataUrl);
  await page.waitForTimeout(250);
  const imgAfter = await fl.locator(".slide.active img").count();
  r.push({ name: "이미지 붙여넣기 — img 추가", pass: imgAfter === imgBefore + 1, info: `${imgBefore}->${imgAfter}` });
  r.push({ name: "붙여넣은 이미지 자동 선택", pass: await fl.locator(".slide.active img.hre-sel-img").count() === 1 });
  // 핸들도 표시되어야
  r.push({ name: "붙여넣기 후 리사이즈 핸들 표시", pass: await page.locator("#imgHandle").isVisible() });

  // 2) 삭제: li 하나 선택 -> 패널 삭제 버튼
  const liCountBefore = await fl.locator(".slide.active li").count();
  await fl.locator(".slide.active li").first().click(); await page.waitForTimeout(150);
  r.push({ name: "텍스트 선택 시 삭제 버튼 표시", pass: (await page.locator("#pp_del").count()) > 0 });
  await page.click("#pp_del"); await page.waitForTimeout(200);
  const liCountAfter = await fl.locator(".slide.active li").count();
  r.push({ name: "삭제 후 li 수 감소", pass: liCountAfter === liCountBefore - 1, info: `${liCountBefore}->${liCountAfter}` });

  // 3) Undo 로 복구
  await page.click("#undoBtn"); await page.waitForTimeout(250);
  const liCountUndo = await fl.locator(".slide.active li").count();
  r.push({ name: "Undo 로 삭제 복구", pass: liCountUndo === liCountBefore, info: "after undo=" + liCountUndo });

  // 4) Del 키로 이미지 삭제 (iframe doc 에 직접 dispatch — 실브라우저에선 포커스 라우팅으로 동작)
  await fl.locator(".slide.active img").first().click(); await page.waitForTimeout(150);
  const imgN = await fl.locator(".slide.active img").count();
  await page.evaluate(() => {
    const d = document.querySelector("#frame").contentDocument;
    d.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true, cancelable: true }));
  });
  await page.waitForTimeout(200);
  r.push({ name: "Del 키로 그림 삭제", pass: (await fl.locator(".slide.active img").count()) === imgN - 1 });

  await page.close();
  return { title: "클립보드 붙여넣기 + 선택 요소 삭제", results: r, errs };
}

export async function checkPdfExport(ctx) {
  const r = [];
  const id = await uploadFixture("multi-slide.html");  // 4 슬라이드
  const page = await ctx.newPage(); const errs = trackErrors(page);
  await page.goto(BASE + "/raw/" + id, { waitUntil: "load" }); await page.waitForTimeout(400);
  // 앱과 동일한 print.css 주입 후 print 미디어 에뮬레이트
  await page.evaluate(() => {
    const l = document.createElement("link"); l.rel = "stylesheet"; l.media = "print"; l.href = "/static/print.css";
    document.head.appendChild(l);
  });
  await page.emulateMedia({ media: "print" }); await page.waitForTimeout(300);
  const m = await page.evaluate(() => {
    const slides = [...document.querySelectorAll(".slide")];
    return { count: slides.length, visible: slides.every((s) => getComputedStyle(s).opacity === "1"), bodyH: document.body.scrollHeight };
  });
  r.push({ name: "인쇄 시 전 슬라이드 노출", pass: m.visible && m.count === 4, info: "slides=" + m.count + " visible=" + m.visible });
  r.push({ name: "슬라이드당 1페이지(높이≈N*900)", pass: m.bodyH >= 3.5 * 900, info: "bodyH=" + m.bodyH });
  const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
  r.push({ name: "PDF 생성됨(비어있지 않음)", pass: pdf.length > 3000, info: pdf.length + " bytes" });
  const s = pdf.toString("latin1");
  const pages = (s.match(/\/Type\s*\/Page[^s]/g) || []).length;
  r.push({ name: "PDF 페이지 수 = 슬라이드 수(4)", pass: pages === 4, info: "pages=" + pages });
  await page.emulateMedia({ media: "screen" });
  await page.close();
  return { title: "PDF 내보내기(원본 16:9 비율)", results: r, errs };
}

export async function checkImagePersist(ctx) {
  const r = [];
  const id = await uploadFixture("simple-slide.html");
  // 1차: 이미지 이동 + 저장
  let { page, errs } = await openEditor(ctx, id);
  let fl = page.frameLocator("#frame");
  await page.click("#modeBtn"); await page.waitForTimeout(300);
  await fl.locator(".slide.active img").first().click(); await page.waitForTimeout(200);
  await page.fill("#pp_x", "50"); await page.dispatchEvent("#pp_x", "input"); await page.waitForTimeout(200);
  const putP = page.waitForResponse((rr) => rr.url().includes("/api/decks/" + id) && rr.request().method() === "PUT");
  await page.click("#saveBtn"); await putP; await page.waitForTimeout(200);
  await page.close();
  // 2차: 재오픈 후 선택 시 위치(50)가 dataset 으로 복원되는지 (점프 방지)
  const re = await openEditor(ctx, id);
  await re.page.click("#modeBtn"); await re.page.waitForTimeout(300);
  await re.page.frameLocator("#frame").locator(".slide.active img").first().click(); await re.page.waitForTimeout(200);
  const xVal = await re.page.locator("#pp_x").inputValue();
  r.push({ name: "재오픈 후 이미지 위치 복원(점프 방지)", pass: xVal === "50", info: "pp_x=" + xVal });
  await re.page.close();
  return { title: "이미지 위치 영속성", results: r, errs };
}

export async function checkPropPanel(ctx) {
  const r = [];
  const id = await uploadFixture("simple-slide.html");
  const { page, errs } = await openEditor(ctx, id);
  const fl = page.frameLocator("#frame");
  await page.click("#modeBtn"); await page.waitForTimeout(300);
  const li = fl.locator(".slide.active li").first();
  await li.click(); await page.waitForTimeout(200);
  r.push({ name: "텍스트 선택 시 속성패널 표시", pass: await page.locator("#propPanel").isVisible() });
  r.push({ name: "글자 크기 필드 존재", pass: (await page.locator("#pp_fs").count()) > 0 });
  await page.fill("#pp_fs", "44"); await page.dispatchEvent("#pp_fs", "input"); await page.waitForTimeout(200);
  const fs = await li.evaluate((e) => e.style.fontSize);
  r.push({ name: "패널 크기 입력 -> 적용", pass: fs === "44px", info: fs });
  // 색/정렬
  await page.locator('#propPanel .palign button[data-al="center"]').click(); await page.waitForTimeout(150);
  r.push({ name: "정렬 가운데 적용", pass: (await li.evaluate((e) => e.style.textAlign)) === "center" });
  // 이미지 패널
  const img = fl.locator(".slide.active img").first();
  await img.click(); await page.waitForTimeout(200);
  r.push({ name: "그림 선택 시 너비 필드", pass: (await page.locator("#pp_w").count()) > 0 });
  await page.fill("#pp_w", "420"); await page.dispatchEvent("#pp_w", "input"); await page.waitForTimeout(200);
  r.push({ name: "패널 너비 입력 -> 적용", pass: (await img.evaluate((e) => e.style.width)) === "420px" });
  await page.close();
  return { title: "선택 요소 속성 패널", results: r, errs };
}

export async function checkUploadPrecheck(ctx) {
  const r = []; const page = await ctx.newPage(); const errs = trackErrors(page);
  await page.goto(BASE + "/", { waitUntil: "load" }); await page.waitForTimeout(300);
  // 외부 리소스 픽스처 -> confirm 경고 떠야 함 (취소)
  let dialogMsg = "";
  page.once("dialog", (d) => { dialogMsg = d.message(); d.dismiss(); });
  await page.setInputFiles("#fileInput", join(FIX, "external-resource-slide.html"));
  await page.waitForTimeout(500);
  r.push({ name: "외부리소스 업로드 시 경고", pass: /외부 리소스/.test(dialogMsg), info: dialogMsg.slice(0, 40) });
  r.push({ name: "취소 시 업로드 안 됨", pass: /취소됨/.test(await page.locator("#uploadErr").textContent()) });
  await page.close();
  return { title: "업로드 전 외부리소스 검사", results: r, errs };
}

export async function checkMobileLayout(ctx) {
  const r = []; const errsAll = [];
  const id = await uploadFixture("image-heavy-slide.html");
  const vps = [{ w: 390, h: 844 }, { w: 430, h: 932 }, { w: 768, h: 1024 }];
  for (const vp of vps) {
    const page = await ctx.newPage(); const errs = trackErrors(page); errsAll.push(...errs);
    await page.setViewportSize({ width: vp.w, height: vp.h });
    await page.goto(BASE + "/editor/" + id, { waitUntil: "load" }); await page.waitForTimeout(900);
    const m = await page.evaluate(() => {
      const ebar = document.querySelector(".ebar");
      const frame = document.querySelector("#frame");
      return {
        sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth,
        barH: ebar ? Math.round(ebar.getBoundingClientRect().height) : 0,
        frameH: frame ? Math.round(frame.getBoundingClientRect().height) : 0,
        vh: window.innerHeight,
      };
    });
    const noscroll = m.sw <= m.cw + 1;
    const frameOk = m.frameH >= 0.40 * m.vh;
    r.push({ name: `${vp.w}px 가로스크롤 없음`, pass: noscroll, info: `sw=${m.sw} cw=${m.cw}` });
    r.push({ name: `${vp.w}px 툴바 높이<=140`, pass: m.barH <= 140, info: `barH=${m.barH}` });
    r.push({ name: `${vp.w}px iframe 높이>=40vh`, pass: frameOk, info: `frameH=${m.frameH} vh=${m.vh}` });
    // 뷰 모드에서 편집 컨트롤은 숨어 있어야 함
    const ecHidden = await page.locator("#editControls").isHidden();
    r.push({ name: `${vp.w}px 뷰모드 편집컨트롤 숨김`, pass: ecHidden });
    // 편집 모드 진입 후에도 가로스크롤 없어야 함
    await page.click("#modeBtn"); await page.waitForTimeout(250);
    const m2 = await measureNoHScroll(page);
    r.push({ name: `${vp.w}px 편집모드 가로스크롤 없음`, pass: m2.sw <= m2.cw + 1, info: `sw=${m2.sw} cw=${m2.cw}` });
    await page.screenshot({ path: join(SHOTS, `mobile-${vp.w}.png`) });
    await page.close();
  }
  return { title: "모바일 레이아웃 검사", results: r, errs: errsAll };
}
