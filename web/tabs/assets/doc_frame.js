// 의사결정 문서 뷰어의 순수 규칙(DOM 없음, bun 테스트 대상). view.js 가 쓴다.
//
// 문서는 사용자의 Vault HTML 이다. 웹판은 그것을 blob: URL 로 만들어 화면 안 iframe 에 띄우는데, blob: 문서는 만든 페이지의 출처와
// CSP(script-src 'self')를 물려받는다. 그래서
// - 문서 안 <script>(인라인·cdnjs 등 바깥 주소)와 on* 속성은 실행되지 않는다(CSP + sandbox 두 겹).
// - sandbox 에 allow-scripts 를 주지 않는다. allow-same-origin 은 부모가 문서 안 링크 클릭을 가로채려고만 준다.
//   스크립트가 없으니 같은 출처여도 문서가 IndexedDB·localStorage(비밀값)를 읽을 길이 없다. 둘을 함께 주면 문서 스크립트가
//   sandbox 를 스스로 풀 수 있으므로 절대 함께 주지 않는다(tests/js/web/assets_view.test.js 가 막는다).
// - allow-popups·allow-popups-to-escape-sandbox: 바깥 링크를 새 탭에서 평범한 페이지로 연다. 폼 제출·위쪽 창 이동은 주지 않는다.
export const SANDBOX = "allow-same-origin allow-popups allow-popups-to-escape-sandbox";

// 목록 화면에 그대로 보일 수 있는 이미지(같은 폴더). 로컬판 assets_serve.py 가 주던 그림 형식.
export const IMAGE_TYPES = {
  ".png": "image/png", ".svg": "image/svg+xml", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp",
};
const EXTERNAL = new Set(["http", "https", "mailto"]);

// 뷰어가 여는 문서 이름. 로컬판 assets_serve.py _resolve 와 같다: 폴더 바로 아래, 숨김(.)·경로 구분자 없음, .html.
export const docName = (name) => Boolean(name) && !name.startsWith(".") && !name.includes("/") && !name.includes("\\") && name.endsWith(".html");

const extension = (name) => {
  const at = name.lastIndexOf(".");
  return at > 0 ? name.slice(at).toLowerCase() : "";
};

// 상대 주소 → 같은 폴더 파일 이름(쿼리·#조각 제거, %디코드, ./ 허용). 하위·상위 폴더나 못 읽는 주소는 null.
export function sameFolderName(href) {
  const path = String(href).trim().replace(/[?#].*$/s, "").replace(/^\.\//, "");
  if (!path) return null;
  let name;
  try {
    name = decodeURIComponent(path);
  } catch {
    return null;
  }
  return name && !name.includes("/") && !name.includes("\\") && name !== "." && name !== ".." ? name : null;
}

// 문서 안 링크를 어떻게 다룰지. 브라우저가 무시하는 scheme 앞뒤 공백·제어 문자를 지우고 본다.
// {kind: "anchor"} 문서 안 #앵커 · {kind: "external"} 새 탭 · {kind: "doc", file} 같은 폴더 의사결정 문서(뷰어로)
// {kind: "blocked", why} 그 밖(하위 폴더·다른 형식 파일·javascript: 등)
export function linkKind(href) {
  const raw = String(href ?? "");
  const url = raw.replace(/[\x00-\x20\x7f]+/g, "");
  if (url === "" || url.startsWith("#")) return { kind: "anchor" };
  const scheme = url.match(/^([a-z][a-z0-9+.-]*):/i);
  if (scheme) {
    return EXTERNAL.has(scheme[1].toLowerCase()) ? { kind: "external" } : { kind: "blocked", why: `${scheme[1]}: 주소는 열지 않는다` };
  }
  if (url.startsWith("//")) return { kind: "external" };
  const name = sameFolderName(raw);
  if (name && docName(name)) return { kind: "doc", file: name };
  return { kind: "blocked", why: "웹 화면은 의사결정 폴더 바로 아래 HTML 문서만 연다" };
}

// <img src> → 같은 폴더 그림 파일 이름(바꿔 넣을 것) 또는 null(그대로 둔다).
export function imageName(src) {
  const raw = String(src ?? "");
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw.trim()) || raw.trim().startsWith("//")) return null;
  const name = sameFolderName(raw);
  return name && !name.startsWith(".") && Object.hasOwn(IMAGE_TYPES, extension(name)) ? name : null;
}

export const imageType = (name) => IMAGE_TYPES[extension(name)];
