// 의사결정 문서 뷰어(웹). 설정의 폴더 핸들에서 문서를 읽어 화면 안 sandbox iframe 에 띄운다. 규칙은 doc_frame.js.
// - 같은 폴더 그림(<img src="그림.svg">)은 data: 주소로 바꿔 넣는다(로컬판은 서버가 같은 폴더 파일을 줬다).
// - 바깥 링크는 새 탭, 같은 폴더 문서 링크는 이 뷰어, 그 밖의 링크(하위 폴더·다른 형식)는 막고 위에 알린다.
// - 문서 안 스크립트는 실행하지 않는다(CSP + sandbox). 스크립트가 있으면 위에 알리고 원본 내려받기를 보인다.
import { tabContext } from "../../lib/tab.js";
import * as fsa from "../../lib/fsa.js";
import { FROM_LIST, displayName } from "./assets_index.js";
import { docName, imageName, imageType, linkKind } from "./doc_frame.js";

const $ = (id) => document.getElementById(id);
const frame = $("doc");
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

// 문서 HTML 을 실행·로드 없이 파싱해(DOMParser) 그림·바깥 링크만 고친 뒤 다시 글로 만든다. 스크립트 수를 함께 돌려준다.
async function prepare(folder, text) {
  const doc = new DOMParser().parseFromString(text, "text/html");
  for (const a of doc.querySelectorAll("a[href]")) {
    if (linkKind(a.getAttribute("href")).kind === "external") {
      a.target = "_blank";
      a.rel = "noopener noreferrer";
    }
  }
  for (const img of doc.querySelectorAll("img[src]")) {
    const name = imageName(img.getAttribute("src"));
    if (name) img.setAttribute("src", (await dataUrl(folder, name)) ?? "");
  }
  const scripts = doc.querySelectorAll("script").length;
  const handlers = [...doc.querySelectorAll("*")].filter((el) => [...el.attributes].some((attr) => /^on/i.test(attr.name))).length;
  const html = (doc.doctype ? "<!doctype html>\n" : "") + doc.documentElement.outerHTML;
  return { html, scripts, handlers };
}

// 문서 안 클릭: 같은 폴더 문서는 이 뷰어로, 막을 링크는 막고 알린다. 앵커·바깥 링크는 브라우저에 맡긴다.
function intercept() {
  let inner;
  try {
    inner = frame.contentDocument;
  } catch {
    return;
  }
  inner?.addEventListener("click", (event) => {
    const a = event.target.closest?.("a[href]");
    if (!a) return;
    const kind = linkKind(a.getAttribute("href"));
    if (kind.kind === "doc") {
      event.preventDefault();
      location.hash = encodeURIComponent(kind.file);
    } else if (kind.kind === "blocked") {
      event.preventDefault();
      note(`링크를 열지 않았다: ${a.getAttribute("href")} — ${kind.why}.`, "linknote");
    }
  });
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
  const name = decodeURIComponent(location.hash.slice(1));
  if (!name) { message("열 문서 파일명이 없다. 목록에서 문서를 누른다."); return; }
  const title = displayName(name.normalize("NFC")) || name;
  $("title").textContent = title;
  document.title = `${title} · 문서 보기`;
  try {
    const { folder, file } = await open(name);
    if (file === null) { message("브라우저가 폴더 접근 권한을 다시 묻는다.", reconnect(folder)); return; }
    const bytes = await file.arrayBuffer();
    const { html, scripts, handlers } = await prepare(folder, new TextDecoder("utf-8").decode(bytes));
    const download = $("download");
    download.href = blobUrl([bytes], "text/html");
    download.download = name;
    if (scripts || handlers) {
      note(`이 문서의 스크립트 ${scripts}개${handlers ? `·이벤트 속성 ${handlers}곳` : ""}은 웹 화면에서 실행하지 않는다(보안). `
        + "스크립트로 그리는 그림·차트·버튼은 비거나 움직이지 않는다. 원본을 내려받아 열거나, ← 목록의 경로 복사로 Vault 에서 연다.");
      download.hidden = false;
    }
    $("msg").hidden = true;
    frame.hidden = false;
    frame.onload = intercept;
    frame.src = blobUrl([html], "text/html;charset=utf-8");
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
