// README 시연 GIF 용 화면 녹화. scripts/demo/record.sh 가 목업 서버를 띄운 뒤 playwright 를 깐 임시 폴더에서 실행한다.
// 환경 변수: BASE(서버 주소), VIDEO_DIR(webm 저장 폴더), DEMO_HOME(mock_data.py 로 만든 임시 HOME, Jira 목업 links 를 읽는다).
// 영상은 하나로 찍고, 탭마다 장면 구간을 VIDEO_DIR/scenes.txt 에 `탭id 시작초 길이초` 한 줄씩 남긴다.
// 탭을 옮겨 다니는 사이는 구간에 넣지 않으므로 record.sh 가 자른 GIF 는 그 탭 화면만 담는다.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const BASE = process.env.BASE;
const VIDEO_DIR = process.env.VIDEO_DIR;
const JIRA = JSON.parse(readFileSync(join(process.env.DEMO_HOME, "demo-jira.json"), "utf8"));
const SIZE = { width: 1440, height: 900 };

const browser = await chromium.launch();
// 셸·탭 화면은 시스템 다크 모드(prefers-color-scheme)를 따른다. 주간 보고 뷰어는 자체 테마 저장값을 읽으므로 미리 dark 로 둔다.
const context = await browser.newContext({ viewport: SIZE, recordVideo: { dir: VIDEO_DIR, size: SIZE }, locale: "ko-KR",
  colorScheme: "dark" });
await context.addInitScript(() => { try { localStorage.setItem("weekly-viewer:theme", "dark"); } catch { /* 무시 */ } });
const page = await context.newPage();
const began = Date.now();
const now = () => (Date.now() - began) / 1000;
const pause = (ms) => page.waitForTimeout(ms);

// 녹화에는 마우스 포인터가 찍히지 않는다. 셸 문서 맨 위에 가짜 포인터를 두고 누를 곳까지 옮긴다.
// 탭 화면은 iframe 이라 포인터는 셸에만 두고, 좌표는 locator.boundingBox()(셸 기준)로 잡는다.
async function installCursor() {
  await page.evaluate(() => {
    const el = document.createElement("div");
    el.id = "demo-cursor";
    el.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24"><path d="M3 2l7 19 2.5-7.5L20 11z" fill="#111" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>';
    Object.assign(el.style, { position: "fixed", zIndex: 2147483647, pointerEvents: "none",
      transition: "left .45s ease, top .45s ease, transform .12s" });
    document.body.append(el);
  });
}

async function placeCursor(x, y, animate) {
  await page.evaluate(([x, y, animate]) => {
    const el = document.getElementById("demo-cursor");
    el.style.transition = animate ? "left .45s ease, top .45s ease, transform .12s" : "none";
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
  }, [x, y, animate]);
}

// 같은 글자가 숨은 요소(목록 원본·select 등)에도 있을 수 있어 보이는 첫 요소만 누른다.
async function click(target, after = 1600) {
  const locator = target.filter({ visible: true }).first();
  await locator.waitFor({ state: "visible" });
  // 화면 밖이면 클릭이 스크롤하면서 좌표가 바뀐다. 먼저 보이게 한 뒤 포인터 좌표를 잰다.
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  const x = box.x + Math.min(box.width / 2, 60), y = box.y + box.height / 2;
  await placeCursor(x, y, true);
  await pause(550);
  await page.evaluate(() => { document.getElementById("demo-cursor").style.transform = "scale(.8)"; });
  await locator.click({ position: { x: x - box.x, y: y - box.y } });
  await page.evaluate(() => { document.getElementById("demo-cursor").style.transform = ""; });
  await pause(after);
}

// 누른 채로 끌어 놓는다. 포인터 그림도 같은 경로로 옮긴다. 끝점(tx, ty)은 셸 기준 좌표다.
// 끌기 시작점은 막대·파일 줄의 왼쪽 글자 위(왼쪽 끝 손잡이는 피한다).
async function drag(target, toPoint, after = 1600) {
  const locator = target.filter({ visible: true }).first();
  await locator.waitFor({ state: "visible" });
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  const sx = box.x + Math.min(box.width / 2, 60), sy = box.y + box.height / 2;
  const { x: tx, y: ty } = await toPoint({ sx, sy });
  await placeCursor(sx, sy, true);
  await pause(550);
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.evaluate(() => { document.getElementById("demo-cursor").style.transform = "scale(.8)"; });
  const steps = 24;
  for (let i = 1; i <= steps; i += 1) {
    const x = sx + ((tx - sx) * i) / steps, y = sy + ((ty - sy) * i) / steps;
    await placeCursor(x, y, false);
    await page.mouse.move(x, y);
    await pause(35);
  }
  await pause(300);
  await page.mouse.up();
  await page.evaluate(() => { document.getElementById("demo-cursor").style.transform = ""; });
  await pause(after);
}

// 입력 칸을 누르고 사람이 치듯 한 글자씩 넣는다.
async function type(target, text, after = 600) {
  await click(target, 200);
  await target.filter({ visible: true }).first().pressSequentially(text, { delay: 70 });
  await pause(after);
}

const nav = (id) => page.locator(`#nav a[data-id='${id}']`);
const frame = (id) => page.frameLocator(`iframe[src^='/${id}/']`);
const frameOf = (id) => page.frames().find((f) => new URL(f.url()).pathname === `/${id}/`);

// 탭마다 다 그려졌다고 볼 요소.
const READY = {
  wbs: () => frame("wbs").getByText("캘린더", { exact: true }),
  assets: () => frame("assets").locator("button[data-tab='open']"),
  plans: () => frame("plans").locator("button[data-tab='todo']"),
  meetings: () => frame("meetings").getByText("결제 연동", { exact: true }),
  weekly: () => frame("weekly").locator("#briefing-tab"),
};

const scenes = [];
// name: GIF 파일 이름. tab: 사이드바 탭 id(기본은 name). prepare: 탭으로 옮긴 뒤 구간 시작 전에 할 일.
async function scene(name, body, { tab = name, prepare } = {}) {
  // 탭으로 옮기고 화면이 뜨기까지는 구간 밖이다. 포인터는 화면 가운데에서 시작한다.
  await nav(tab).click();
  if (prepare) await prepare();
  await READY[tab]().first().waitFor({ state: "visible" });
  await pause(900);
  await placeCursor(SIZE.width / 2 + 100, SIZE.height / 2, false);
  await pause(200);
  const start = now();
  await body();
  await pause(600);
  scenes.push(`${name} ${start.toFixed(2)} ${(now() - start).toFixed(2)}`);
  // 영상 시각과 기록 시각이 조금 어긋나도 다음 탭이 GIF 끝에 섞이지 않게, 구간 뒤에 그대로 멈춰 둔다.
  await pause(1500);
}

// WBS 탭을 머리글부터 보이게 맨 위로 올린다(캘린더는 오늘 주로 스크롤해 둔다).
const wbsToTop = () => frameOf("wbs").evaluate(() => window.scrollTo(0, 0));

await page.goto(`${BASE}/#wbs`);
await installCursor();

// WBS 엑셀만: Jira 에 로그인하지 않은 상태. 로그인 안내 줄은 시연에 필요 없어 가린다.
await scene("wbs", async () => {
  await pause(1800);
  await click(frame("wbs").locator("[data-dom='주문']"), 1500);
  await click(frame("wbs").locator("[data-dom='주문']"), 1200);
  await click(frame("wbs").getByText("보드", { exact: true }), 2800);
}, {
  prepare: async () => {
    await frame("wbs").getByText("캘린더", { exact: true }).waitFor();
    await frameOf("wbs").addStyleTag({ content: "#jira{display:none!important}" });
    await wbsToTop();
  },
});

// WBS + Jira 연동: 목업 서버(serve_demo.py)의 Jira 는 아무 이메일·token 이나 받는다. 구간 밖에서 로그인하고,
// WBS 행과 Jira 이슈를 탭의 수동 연결 API 로 이은 뒤(목업 links) 캘린더로 다시 연다.
await scene("wbs-jira", async () => {
  await wbsToTop();
  await pause(2000);
  await click(frame("wbs").getByText("보드", { exact: true }), 2800);
  // 일정 조정: 막대 몸통을 끌어 기간을 이틀 미룬다. Jira 에는 보내지 않고 변경안(초안)으로만 남는다.
  await click(frame("wbs").getByText("일정 조정", { exact: true }), 1600);
  const cell = await frame("wbs").locator("[data-date]").first().boundingBox();
  await drag(frame("wbs").locator(".bar.editable[data-key='DEMO-105']"),
    async ({ sx, sy }) => ({ x: sx + cell.width * 2, y: sy }), 1000);
  // 위의 변경안 목록(일정 조정 초안)에 방금 끈 일정이 쌓인 것을 보여 준다.
  await frameOf("wbs").evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
  await pause(2800);
  await click(frame("wbs").getByText("워크로그", { exact: true }), 1200);
  await click(frame("wbs").getByText("지난 주", { exact: true }), 2600);
}, {
  tab: "wbs",
  prepare: async () => {
    const login = await page.request.post(`${BASE}/wbs/api/login`, { data: { email: "dobby@example.com", token: "demo" } });
    if (!login.ok()) throw new Error(`목업 Jira 로그인 실패: ${login.status()} ${await login.text()}`);
    for (const [task, key] of Object.entries(JIRA.links)) {
      const res = await page.request.put(`${BASE}/wbs/api/links`, { data: { task, key } });
      if (!res.ok()) throw new Error(`수동 연결 실패 ${task} → ${key}: ${res.status()} ${await res.text()}`);
    }
    await frameOf("wbs").evaluate(() => { location.hash = "tab=calendar"; location.reload(); });
    await frame("wbs").locator("#jiraout").waitFor({ state: "visible" });
  },
});

await scene("assets", async () => {
  await pause(1600);
  await click(frame("assets").locator("button[data-feature='결제']"), 1600);
  await click(frame("assets").locator("button[data-feature='']"), 1000);
  await click(frame("assets").locator("button[data-tab='closed']"), 2000);
  // 문서 이름을 누르면 탭 화면이 그 문서로 바뀐다. 문의 현황 표를 보고 뒤로 가기로 목록에 돌아온다.
  await click(frame("assets").locator("a", { hasText: "주문 취소 정책 확인 요청" }), 0);
  await frame("assets").locator("section.docst").waitFor({ state: "visible" });
  await pause(2200);
  await placeCursor(900, 600, true);
  await page.mouse.move(900, 600);
  await page.mouse.wheel(0, 300);
  await pause(1800);
  const doc = await (await page.locator("iframe[src^='/assets/']").elementHandle()).contentFrame();
  await doc.evaluate(() => history.back());
  await frame("assets").locator("button[data-tab='closed']").waitFor({ state: "visible" });
  await pause(1800);
});

await scene("plans", async () => {
  await pause(1600);
  await click(frame("plans").locator("button[data-tab='doing']"), 2400);
  await click(frame("plans").locator("button[data-tab='done']"), 2200);
});

await scene("meetings", async () => {
  await pause(1600);
  await click(frame("meetings").locator("a", { hasText: "PG사 비교표.md" }), 2600);
  await click(frame("meetings").getByText("주문 알림", { exact: true }), 2000);
  // Vault 파일을 검색해 회의 블록으로 끌어다 놓는다.
  await type(frame("meetings").getByPlaceholder("파일 검색"), "결제 흐름", 900);
  await drag(frame("meetings").locator(".node.file", { hasText: "결제 흐름 정리.md" }), async () => {
    const list = await frame("meetings").locator("section.block ul.items").first().boundingBox();
    return { x: list.x + list.width / 2, y: list.y + list.height - 6 };
  }, 2000);
  // + 링크로 웹 페이지(OneDrive·위키 등) 주소를 같은 블록에 넣는다.
  await click(frame("meetings").locator("section.block button.add-link"), 400);
  const url = frame("meetings").locator("section.block input[name='url']");
  await url.pressSequentially("https://example.com/wiki/alimtalk-guide", { delay: 45 });
  await pause(400);
  await url.press("Enter");
  await pause(2600);
});

await scene("weekly", async () => {
  await pause(1600);
  await placeCursor(980, 600, true);
  await page.mouse.move(980, 600);
  await pause(500);
  await page.mouse.wheel(0, 600);
  await pause(2200);
  await click(frame("weekly").locator("#document-tab"), 2400);
});

writeFileSync(join(VIDEO_DIR, "scenes.txt"), scenes.join("\n") + "\n");
await context.close();
await browser.close();
