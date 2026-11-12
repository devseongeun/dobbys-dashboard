// 의사결정 문서 뷰어(웹). 설정의 폴더 핸들에서 문서를 읽어 정제한 글을 화면 안 sandbox iframe 의 srcdoc 으로 띄운다.
// 규칙은 doc_frame.js. 문서용 blob: 주소는 만들지 않는다(새 탭으로 열릴 주소가 없다).
// - 같은 폴더 그림(<img src="그림.svg">)은 data: 주소로 바꿔 넣는다(로컬판은 서버가 같은 폴더 파일을 줬다).
// - 문서 안 링크는 모두 부모가 처리한다(doc_frame.js handleLink): #앵커는 스크롤, 바깥 링크는 새 탭(noopener),
//   같은 폴더 문서는 이 뷰어, 같은 폴더 pdf·그림은 내려받기, 그 밖(하위 폴더·javascript: 등)은 막고 위에 알린다.
// - 문서 안 스크립트·바깥 그림·글꼴은 불러오지 않는다(CSP + sandbox). 있으면 위에 알리고 원본 내려받기를 보인다.
import { tabContext } from "../../lib/tab.js";
import * as fsa from "../../lib/fsa.js";
import { FROM_LIST, displayName } from "./assets_index.js";
import { SANDBOX, blockedNotice, cleanDoc, docName, handleLink, imageType } from "./doc_frame.js";

const $ = (id) => document.getElementById(id);
let frame = $("doc");
let urls = [];  // 내려받기용 blob: 주소(형식 application/octet-stream, HTML 로 렌더되지 않는다)

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

// 문서 HTML 을 실행·로드 없이 파싱해(DOMParser) 정제(doc_frame.js cleanDoc)한 뒤 다시 글로 만든다.
// 같은 폴더 그림은 data: 로 바꿔 넣는다. 막히는 것(스크립트·on* 속성·바깥 그림·바깥 스타일시트와 글꼴)의 수를 함께 돌려준다.
async function prepare(folder, text) {
  const doc = new DOMParser().parseFromString(text, "text/html");
  const { counts, images } = cleanDoc(doc);
  for (const { el, name } of images) el.setAttribute("src", (await dataUrl(folder, name)) ?? "");
  const html = (doc.doctype ? "<!doctype html>\n" : "") + doc.documentElement.outerHTML;
  return { html, counts };
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

// 문서의 DOM clobbering(<form name="addEventListener"> 등)에 흔들리지 않게 부모 쪽 원형 메서드로 부른다.
const call = (Type, method, self, ...args) => Type.prototype[method].call(self, ...args);

// 문서 안 링크의 click·auxclick(가운데 클릭)·Enter 를 모두 부모가 받는다(doc_frame.js handleLink).
// 문서 안에는 실제 href 가 없어(cleanDoc) 이 처리기가 붙기 전(load 전)에는 링크를 눌러도 아무 데도 가지 않는다.
function attach(target) {
  if (target !== frame) return;  // 그사이 다른 문서로 바뀌었다
  let inner;
  try {
    inner = target.contentDocument;
  } catch {
    return;
  }
  if (!inner) return;
  const linkDone = () => note("", "linknote");
  const actions = {
    scrollTo: (id) => {
      linkDone();
      const el = id ? call(Document, "getElementById", inner, id) ?? call(Document, "getElementsByName", inner, id)[0] : null;
      if (el) call(Element, "scrollIntoView", el, { block: "start" });
      else if (id === "" || id.toLowerCase() === "top") target.contentWindow?.scrollTo(0, 0);  // href="#"·"#top" 은 맨 위로
    },
    openExternal: (href) => { linkDone(); window.open(new URL(href, location.href).href, "_blank", "noopener,noreferrer"); },
    // 문서→문서 이동은 기록을 남기지 않아 '← 목록'(뒤로 가기)이 목록으로 돌아간다.
    openDoc: (file) => { linkDone(); location.replace("#" + encodeURIComponent(file)); },
    openFile: (file) => { linkDone(); downloadFile(file); },
    note: (text) => note(text, "linknote"),
  };
  for (const type of ["click", "auxclick", "keydown"]) call(EventTarget, "addEventListener", inner, type, (event) => handleLink(event, actions), true);
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
    // 문서마다 새 iframe 으로 갈아 끼운다(같은 iframe 의 문서를 바꾸면 탭 기록이 쌓여 '← 목록'이 앞 문서로 간다).
    // sandbox 를 srcdoc 보다 먼저 붙이고, src 는 쓰지 않는다(문서 주소 about:srcdoc).
    const fresh = frame.cloneNode(false);
    fresh.setAttribute("sandbox", SANDBOX);
    fresh.removeAttribute("src");
    fresh.hidden = false;
    fresh.onload = () => attach(fresh);
    fresh.srcdoc = html;
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
