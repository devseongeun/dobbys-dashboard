// File System Access API 얇은 층(Chrome·Edge). 선택 창은 사용자 클릭 안에서만 부른다.
// 핸들은 IndexedDB(store.js)에 그대로 저장한다. 절대 경로는 얻을 수 없어 '경로 복사'는 사용자가 적은 실제 경로 + resolve() 로 만든다.

export const supported = () => typeof globalThis.showDirectoryPicker === "function" && typeof globalThis.showOpenFilePicker === "function";

// FileSystemHandle 인가. 브라우저에서는 instanceof, 테스트의 가짜 핸들은 모양으로 본다.
export function isHandle(value) {
  if (!value || typeof value !== "object") return false;
  if (typeof globalThis.FileSystemHandle === "function" && value instanceof globalThis.FileSystemHandle) return true;
  return (value.kind === "file" || value.kind === "directory") && typeof value.name === "string" && typeof value.isSameEntry === "function";
}

// 선택 창 id 는 32자 이하 [A-Za-z0-9_-]. 칸마다 고정해 브라우저가 지난 위치를 기억하게 한다.
export const pickerId = (id) => String(id ?? "").replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 32) || undefined;

const MIME_OF = {
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".md": "text/markdown",
  ".json": "application/json",
};

// [".xlsx"] → showOpenFilePicker types. 비면 모든 파일.
export function pickerTypes(accept) {
  const exts = (accept ?? []).map((ext) => String(ext).toLowerCase()).filter((ext) => /^\.[a-z0-9]+$/.test(ext));
  if (!exts.length) return undefined;
  const byMime = {};
  for (const ext of exts) (byMime[MIME_OF[ext] ?? "application/octet-stream"] ??= []).push(ext);
  return [{ description: exts.join(", "), accept: byMime }];
}

const options = (raw) => Object.fromEntries(Object.entries(raw).filter(([, value]) => value !== undefined && value !== null));

// 취소(AbortError)면 null. 그 밖의 거절(SecurityError 등)은 예외로 올려 칸 아래에 보인다.
async function cancellable(run) {
  try {
    return await run();
  } catch (error) {
    if (error?.name === "AbortError") return null;
    throw error;
  }
}

export function pickDirectory({ id, mode = "read", startIn } = {}) {
  return cancellable(() => globalThis.showDirectoryPicker(options({ id: pickerId(id), mode, startIn })));
}

export async function pickFile({ id, accept, startIn } = {}) {
  const picked = await cancellable(() => globalThis.showOpenFilePicker(options({ id: pickerId(id), types: pickerTypes(accept), startIn, multiple: false })));
  return picked?.[0] ?? null;
}

// 'granted' | 'prompt' | 'denied'. 핸들이 없거나 물어볼 수 없으면 'denied'.
export async function permission(handle, mode = "read") {
  if (!handle || typeof handle.queryPermission !== "function") return "denied";
  try {
    return await handle.queryPermission({ mode });
  } catch {
    return "denied";
  }
}

// 클릭 안에서만 부른다(requestPermission 은 사용자 동작이 필요하다).
export async function reconnect(handle, mode = "read") {
  if (!handle || typeof handle.requestPermission !== "function") return "denied";
  return handle.requestPermission({ mode });
}

// 고른 폴더부터 handle 까지의 이름 배열(하위 폴더 포함). 폴더 밖이거나 알 수 없으면 null.
export async function relativePath(rootHandle, handle) {
  if (!rootHandle || typeof rootHandle.resolve !== "function" || !handle) return null;
  try {
    const parts = await rootHandle.resolve(handle);
    return Array.isArray(parts) ? parts : null;
  } catch {
    return null;
  }
}

// 사용자가 적은 실제 경로의 구분자를 정리한다. 역슬래시나 드라이브 문자(C:)가 있으면 Windows 경로로 본다.
// 연속 구분자는 하나로, 끝 구분자는 뗀다(루트 '/'·'C:\' 는 남긴다). UNC(\\서버\공유) 앞 두 글자는 지킨다.
export function cleanRealRoot(realRoot) {
  const raw = String(realRoot ?? "").trim();
  if (!raw) return null;
  const windows = raw.includes("\\") || /^[A-Za-z]:/.test(raw);
  const sep = windows ? "\\" : "/";
  const unc = windows && /^[\\/]{2}[^\\/]/.test(raw);
  let root = raw.replace(/[\\/]+/g, sep);
  if (unc) root = sep + root;
  while (root.length > 1 && root.endsWith(sep) && !/^[A-Za-z]:\\$/.test(root)) root = root.slice(0, -1);
  return { root, sep };
}

// 실제 경로 + resolve() 조각 → 복사할 경로. parts 가 null(폴더 밖)이거나 실제 경로가 비면 null.
export function joinRealPath(realRoot, parts) {
  if (!Array.isArray(parts)) return null;
  const cleaned = cleanRealRoot(realRoot);
  if (!cleaned) return null;
  const { root, sep } = cleaned;
  const rest = parts.map(String).filter(Boolean);
  if (!rest.length) return root;
  return (root.endsWith(sep) ? root : root + sep) + rest.join(sep);
}

// 실제 경로의 마지막 조각이 고른 폴더 이름과 다른가. 브라우저는 실제 위치를 확인할 수 없어 이름만 비교해 경고한다.
export function realPathMismatch(realRoot, name) {
  const cleaned = cleanRealRoot(realRoot);
  if (!cleaned || !name) return false;
  const last = cleaned.root.split(cleaned.sep).filter(Boolean).at(-1) ?? "";
  return last.normalize("NFC") !== String(name).normalize("NFC");
}

// 선택·권한 오류 → 칸 아래 문구.
export function errorText(error) {
  if (!supported()) return "이 브라우저는 폴더·파일 선택을 지원하지 않습니다. Chrome·Edge(HTTPS)에서 여세요.";
  if (error?.name === "SecurityError") return "선택 창을 열 수 없습니다. 버튼을 눌러 다시 고르세요(HTTPS 필요).";
  if (error?.name === "NotAllowedError") return "권한이 거부됐습니다. 다시 고르세요.";
  if (error?.name === "NotFoundError") return "고른 폴더·파일을 찾을 수 없습니다. 다시 고르세요.";
  return `선택 실패: ${error?.message ?? error}`;
}
