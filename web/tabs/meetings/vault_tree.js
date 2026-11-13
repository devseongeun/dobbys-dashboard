// 회의 자료 화면의 Vault 트리·파일 검색(브라우저판). 로컬판 tabs/meetings/vault_tree.py 를 옮겼다. 경로 대신 Vault 핸들을 읽는다.
// 숨김(`.`으로 시작) 항목은 보이지 않는다. 이름·경로는 NFC로 돌려준다(macOS 파일명이 NFD여도 검색어·Canvas 경로와 맞게).
import { childDir } from "./meetings_canvas.js";
import { cmp, pyStrip } from "../plans/plans_index.js";

export const SEARCH_LIMIT = 50;

const nfc = (text) => text.normalize("NFC");
// Python str.casefold() 에 가깝게: 대문자로 올렸다 내리면 ß→ss·ﬁ→fi 같은 완전 접기가 되고, 끝 시그마는 σ 로 모은다.
export const casefold = (text) => text.toUpperCase().toLowerCase().replaceAll("ς", "σ");

// Vault 기준 폴더 경로 → 폴더 핸들. 빈 값은 Vault 루트. 절대 경로·역슬래시·빈 조각·`.`으로 시작하는 조각·폴더 아님은 null.
export async function resolveVaultDir(vault, rel) {
  if (rel === "") return vault;
  if (typeof rel !== "string" || rel.startsWith("/") || rel.includes("\\") || rel.includes("\0")) return null;
  const parts = rel.split("/");
  if (parts.some((part) => !part || part.startsWith("."))) return null;
  return childDir(vault, parts);
}

// 폴더 한 단계. 폴더 먼저, 이름(대소문자 무시)순. 없는 폴더는 null.
export async function listDir(vault, rel) {
  const folder = await resolveVaultDir(vault, rel);
  if (!folder) return null;
  const entries = [];
  try {
    for await (const [name, handle] of folder.entries()) {
      if (name.startsWith(".")) continue;
      entries.push({ name: nfc(name), path: nfc(rel ? `${rel}/${name}` : name), dir: handle.kind === "directory" });
    }
  } catch {
    return null;
  }
  return entries.sort((a, b) => (a.dir !== b.dir ? (a.dir ? -1 : 1) : cmp(casefold(a.name), casefold(b.name))));
}

async function walk(dir, prefix, out) {
  let children;
  try {
    children = [];
    for await (const entry of dir.entries()) children.push(entry);
  } catch {
    return; // os.walk 처럼 읽지 못한 폴더는 건너뛴다
  }
  children.sort((a, b) => cmp(a[0], b[0]));
  for (const [name, handle] of children) {
    if (name.startsWith(".")) continue;
    if (handle.kind === "directory") await walk(handle, `${prefix}${name}/`, out);
    else out.push({ name: nfc(name), path: nfc(prefix + name) });
  }
}

// Vault 기준 경로에 검색어가 들어간(대소문자 무시) 파일. 경로순 최대 limit 건, 넘치면 truncated=true. [results, truncated].
export async function search(vault, query, limit = SEARCH_LIMIT) {
  const needle = casefold(nfc(pyStrip(String(query ?? ""))));
  if (!needle) return [[], false];
  const files = [];
  await walk(vault, "", files);
  const results = files.filter((file) => casefold(file.path).includes(needle));
  results.sort((a, b) => cmp(casefold(a.path), casefold(b.path)) || cmp(a.path, b.path));
  return [results.slice(0, limit), results.length > limit];
}
