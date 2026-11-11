// 계획 이름 옆 '경로 복사'. 브라우저는 절대 경로를 모르므로 설정의 실제 경로 칸(folderRealPath) + 폴더 안 상대 경로(resolve())로 만든다.
// 실제 경로 칸이 비면 버튼을 만들지 않는다. resolve() 가 null(폴더 밖)이면 경로를 만들지 않고 안내한다.
import { esc } from "./plans_index.js";
import { joinRealPath, relativePath } from "../../lib/fsa.js";

// 목록에 넣을 버튼 HTML. 마우스를 올리면 복사될 경로(바로 아래 파일이라 실제 경로 + 파일명)가 보인다.
export function copyButtonFor(realRoot) {
  const root = String(realRoot ?? "").trim();
  if (!root) return () => "";
  return (file) => {
    const path = joinRealPath(root, [file]) ?? "";
    return `<button type="button" class="f copy-path" data-copy-file="${esc(file)}" title="${esc(path)}"`
      + ` aria-label="${esc(file)} 시스템 루트 경로 복사" aria-live="polite">경로 복사</button>`;
  };
}

// 누를 때 복사할 경로. {path} 또는 {error: 안내 문구}.
export async function copyPathFor(folder, realRoot, file) {
  const handle = await folder.getFileHandle(file);
  const parts = await relativePath(folder, handle);
  if (parts === null) return { error: "고른 폴더 안의 파일로 확인되지 않아 경로를 만들지 않았다. ⚙ 설정에서 폴더를 다시 고른다." };
  const path = joinRealPath(realRoot, parts);
  if (path === null) return { error: "실제 경로 칸이 비어 있다. ⚙ 설정의 '실제 경로'를 채운다." };
  return { path };
}
