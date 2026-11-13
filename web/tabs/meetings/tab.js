// meetings 탭 등록 항목(web/tabs/manifest.js 가 WEB_TABS 에 넣는다). 로컬판 tabs/meetings/__init__.py 의 TAB.describe() 와
// 같은 문구다. 다른 점: 로컬판은 회의 폴더 하나를 받고 그 위로 올라가며 .obsidian 을 찾지만(find_vault), 브라우저는 고른 폴더
// 위로 올라갈 수 없다. 그래서 Vault 폴더(.obsidian 이 있는 곳, 읽기만)를 먼저 고르고 회의 폴더(읽기·쓰기)를 그 안에서 고른다.
// validate 는 로컬판 _validate 이식 + 회의 폴더가 고른 Vault 안인지(fsa.relativePath) 확인.
import * as fsa from "../../lib/fsa.js";

export const OUTSIDE_VAULT = "Obsidian Vault 안의 폴더를 지정하세요(.obsidian 폴더가 없습니다)";
export const NOT_INSIDE = "위에서 고른 Obsidian Vault 폴더 안의 폴더를 고르세요";
const field = (key, label, extra) => ({
  key, label, kind: "dir", required: true, default: "", options: [], when: null, ...extra,
});

// Vault 바로 아래 .obsidian 폴더가 있는가(로컬판 find_vault 의 판정).
export async function hasObsidian(vault) {
  try {
    await vault.getDirectoryHandle(".obsidian");
    return true;
  } catch (error) {
    if (["NotFoundError", "TypeMismatchError"].includes(error?.name)) return false;
    throw error;
  }
}

// {필드 key: 오류 문구}. 폴더가 비었으면 필수 검사는 셸이 한다.
export async function validate(settings, io = fsa) {
  const { vault, folder } = settings;
  if (!io.isHandle(vault) || !io.isHandle(folder)) return {};
  try {
    if (!(await hasObsidian(vault))) return { vault: OUTSIDE_VAULT };
  } catch (error) {
    return { vault: io.errorText(error) };
  }
  if ((await io.relativePath(vault, folder)) === null) return { folder: NOT_INSIDE };
  return {};
}

export const MEETINGS_TAB = {
  id: "meetings", label: "회의 자료", icon: "📎", src: "tabs/meetings/meetings.html",
  question: "회의 때 볼 자료를 한곳에 모아 두고 싶어요",
  summary: "업무마다 회의 블록을 두고 Vault 파일과 웹 링크를 담아 둬요. Obsidian Vault가 필요하고, Obsidian Canvas에서도 열 수 있어요.",
  experimental: false,
  fields: [
    field("vault", "Obsidian Vault 폴더", {
      mode: "read",
      help: "Vault 맨 위 폴더(.obsidian 폴더가 있는 곳). Canvas 파일 카드는 이 Vault 기준으로 엽니다. 읽기만 합니다. 브라우저는 고른 폴더 위로 올라갈 수 없어 따로 고릅니다.",
    }),
    field("folder", "회의 폴더", {
      mode: "readwrite",
      help: "업무별 Canvas를 둘 Vault 안 폴더(예: …/TRB_400/70-meetings). 위에서 고른 Vault 안의 폴더를 고릅니다. Canvas·순서 파일·휴지통을 이 폴더 안에 씁니다.",
    }),
  ],
  templates: [],
  validate,
};
