// 의사결정 문서 뷰어(웹). 설정의 폴더 핸들에서 문서를 읽어 화면 안 sandbox iframe 에 띄운다. 규칙은 doc_frame.js.
// - 같은 폴더 그림(<img src="그림.svg">)은 data: 주소로 바꿔 넣는다(로컬판은 서버가 같은 폴더 파일을 줬다).
// - 문서 안 링크는 모두 부모가 처리한다(doc_frame.js handleLink): #앵커는 스크롤, 바깥 링크는 새 탭(noopener),
//   같은 폴더 문서는 이 뷰어, 같은 폴더 pdf·그림은 내려받기, 그 밖(하위 폴더·javascript: 등)은 막고 위에 알린다.
// - 문서 안 스크립트·바깥 그림·글꼴은 불러오지 않는다(CSP + sandbox). 있으면 위에 알리고 원본 내려받기를 보인다.
import { tabContext } from "../../lib/tab.js";
import * as fsa from "../../lib/fsa.js";
import { FROM_LIST, displayName } from "./assets_index.js";
import { blockedNotice, docName, handleLink, imageName, imageType, isExternalUrl } from "./doc_frame.js";

const $ = (id) => document.getElementById(id);
let frame = $("doc");
let urls = [];

class Missing extends Error {}

function release() {
  urls.forEach((url) => URL.revokeObjectURL(url));
  urls = [];
}

const blobUrl = (parts, type) => {
  const url = URL.createObjectURL(new Blob(parts, { type }));
  urls.push(url);
  return url;
};

function message(text, ...extra) {
  frame.hidden = true;
  $("msg").replaceChildren(text, ...extra);
  $("msg").hidden = false;
}

// id: "note"(스크립트 안내) · "linknote"(막은 링크 안내).
function note(text, id = "note") {
  $(id).textContent = text;
  $(id).hidden = !text;
}

// 폴더 핸들과 문서 파일 핸들. 권한이 'prompt' 면 file 이 null(다시 연결 버튼을 보인다).
async function open(name) {
  const { settings } = await tabContext("assets");
  const folder = settings?.folder;
  if (!fsa.isHandle(folder)) throw new Error("의사결정 문서 폴더가 없다. ⚙ 설정에서 폴더를 고른다");
  const permission = await fsa.permission(folder, "read");
  if (permission === "prompt") return { folder, file: null };
  if (permission !== "granted") throw new Error("폴더 권한이 거부됐다");
  if (!docName(name)) throw new Missing();
  try {
    return { folder, file: await (await folder.getFileHandle(name)).getFile() };
  } catch (error) {
    if (["NotFoundError", "TypeMismatchError", "TypeError"].includes(error?.name)) throw new Missing();
    throw error;
  }
}

async function dataUrl(folder, name) {
  try {
    const bytes = new Uint8Array(await (await (await folder.getFileHandle(name)).getFile()).arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return `data:${imageType(name)};base64,${btoa(binary)}`;
  } catch {
    return null;  // 없는 그림은 원래 주소를 지워 빈 그림으로 둔다
  }
}

// 문서 HTML 을 실행·로드 없이 파싱해(DOMParser) 고친 뒤 다시 글로 만든다.
// <base> 와 모든 target 속성을 지운다(새 창·다른 창으로 가는 길을 남기지 않는다). 같은 폴더 그림은 data: 로 바꿔 넣는다.
// 막히는 것(스크립트·on* 속성·바깥 그림·바깥 스타일시트와 글꼴)의 수를 함께 돌려준다.
async function prepare(folder, text) {
  const doc = new DOMParser().parseFromString(text, "text/html");
  doc.querySelectorAll("base").forEach((el) => el.remove());
  doc.querySelectorAll("[target]").forEach((el) => el.removeAttribute("target"));
  let images = 0;
  for (const img of doc.querySelectorAll("img[src]")) {
    const src = img.getAttribute("src");
    const name = imageName(src);
    if (name) img.setAttribute("src", (await dataUrl(folder, name)) ?? "");
    else if (isExternalUrl(src)) images += 1;
  }
  const styleText = [...doc.querySelectorAll("style")].map((el) => el.textContent).join("\n");
  const styles = [...doc.querySelectorAll("link[href]")]
    .filter((el) => /(^|\s)stylesheet(\s|$)/i.test(el.getAttribute("rel") ?? "") && isExternalUrl(el.getAttribute("href"))).length
    + (styleText.match(/(?:@import\s+(?:url\()?|url\()\s*["']?(?:https?:)?\/\//gi) ?? []).length;
  const scripts = doc.querySelectorAll("script").length;
  const handlers = [...doc.querySelectorAll("*")].filter((el) => [...el.attributes].some((attr) => /^on/i.test(attr.name))).length;
  const html = (doc.doctype ? "<!doctype html>\n" : "") + doc.documentElement.outerHTML;
  return { html, counts: { scripts, handlers, images, styles } };
}

// 같은 폴더 파일(pdf·그림)을 내려받는다. 새 탭에서 열리지 않게 부모가 download 링크를 만들어 누른다.
async function downloadFile(file) {
  try {
    const { settings } = await tabContext("assets");
    const handle = await settings.folder.getFileHandle(file);
    const a = Object.assign(document.createElement("a"), { href: blobUrl([await (await handle.getFile()).arrayBuffer()], "application/octet-stream"), download: file });
    a.click();
  } catch {
    note(`링크의 파일을 찾지 못했다: ${file}`, "linknote");
  }
}

// 문서 안 링크의 click·auxclick(가운데 클릭)을 모두 부모가 받는다(doc_frame.js handleLink).
// 문서를 다 읽었으면 문서 blob: 주소를 거둔다. iframe 안 문서는 그대로 남고, 같은 주소로 다른 곳에서 다시 열 수 없다.
function attach(docUrl) {
  URL.revokeObjectURL(docUrl);
  urls = urls.filter((url) => url !== docUrl);
  let inner;
  try {
    inner = frame.contentDocument;
  } catch {
    return;
  }
  const actions = {
    scrollTo: (id) => (id ? inner.getElementById(id) ?? inner.getElementsByName(id)[0] : null)?.scrollIntoView({ block: "start" }),
    openExternal: (href) => window.open(new URL(href, location.href).href, "_blank", "noopener,noreferrer"),
    // 문서→문서 이동은 기록을 남기지 않아 '← 목록'(뒤로 가기)이 목록으로 돌아간다.
    openDoc: (file) => location.replace("#" + encodeURIComponent(file)),
    openFile: (file) => downloadFile(file),
    note: (text) => note(text, "linknote"),
  };
  for (const type of ["click", "auxclick"]) inner?.addEventListener(type, (event) => handleLink(event, actions), true);
}

function reconnect(folder) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "back";
  button.textContent = "폴더 다시 연결";
  button.addEventListener("click", async () => { if ((await fsa.reconnect(folder, "read")) === "granted") load(); });
  return button;
}

async function load() {
  release();
  note("");
  note("", "linknote");
  $("download").hidden = true;
  let name;
  try {
    name = decodeURIComponent(location.hash.slice(1));
  } catch {
    message("주소의 문서 이름을 읽을 수 없다(깨진 %인코딩). 목록에서 문서를 다시 누른다.");
    return;
  }
  if (!name) { message("열 문서 파일명이 없다. 목록에서 문서를 누른다."); return; }
  const title = displayName(name.normalize("NFC")) || name;
  $("title").textContent = title;
  document.title = `${title} · 문서 보기`;
  try {
    const { folder, file } = await open(name);
    if (file === null) { message("브라우저가 폴더 접근 권한을 다시 묻는다.", reconnect(folder)); return; }
    const bytes = await file.arrayBuffer();
    const { html, counts } = await prepare(folder, new TextDecoder("utf-8").decode(bytes));
    const download = $("download");
    // 원본 바이트 그대로. HTML 로 열리지 않게(같은 출처 탭에서 렌더되지 않게) 형식은 octet-stream 이다.
    download.href = blobUrl([bytes], "application/octet-stream");
    download.download = name;
    const notice = blockedNotice(counts);
    note(notice);
    download.hidden = !notice;
    $("msg").hidden = true;
    // iframe 의 src 를 바꾸면 탭 기록에 iframe 항목이 쌓여 '← 목록'(뒤로 가기)이 앞 문서(거둔 blob)로 간다.
    // 문서마다 sandbox 속성째 새 iframe 으로 갈아 끼워 기록을 남기지 않는다.
    const docUrl = blobUrl([html], "text/html;charset=utf-8");
    const fresh = frame.cloneNode(false);
    fresh.hidden = false;
    fresh.onload = () => attach(docUrl);
    fresh.src = docUrl;
    frame.replaceWith(fresh);
    frame = fresh;
  } catch (err) {
    message(`${name} 을(를) 열지 못했다: ${err instanceof Missing ? "파일이 없거나 열 수 없는 경로다(폴더 바로 아래, 숨김이 아닌 .html 만 연다)" : err.message}`);
  }
}

// 목록에서 왔으면 뒤로 가기로 돌아가 탭·필터·검색 상태를 살린다(구현 진행 현황 뷰어와 같은 방식).
const fromList = (() => {
  try {
    const mark = sessionStorage.getItem(FROM_LIST);
    sessionStorage.removeItem(FROM_LIST);
    return mark === "1";
  } catch {
    return false;
  }
})();

$("back").addEventListener("click", (e) => {
  if (fromList && history.length > 1) {
    e.preventDefault();
    history.back();
  }
});
window.addEventListener("hashchange", load);
load();
