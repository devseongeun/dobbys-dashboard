// 격리 후보 서버 Chrome 확인용(웹 번들에 넣지 않는다). 회의 자료 탭: 예제 Vault 를 OPFS 에 복사하고 폴더 선택 창을 바꿔 끼운다.
// 사용: python3 tests/web_check/meetings_vault.py <mock_data.py 가 만든 DemoVault> 가 내는 JSON 을 넘겨
//   installMeetingsVault({files: {"<Vault 기준 경로>": {text} | {b64}}, dirs: ["<폴더>"]}) 를 셸 페이지에서 eval 한다.
// 이후 ⚙ 설정의 'Obsidian Vault 폴더 선택'은 OPFS DemoVault, '회의 폴더 선택'은 그 안의 DEMO_100/70-meetings 를 돌려준다
// (fsa.pickerId: meetings-vault·meetings-folder). 운영자의 실제 Vault 는 고르지 않는다.
async function installMeetingsVault({ files, dirs = [] }) {
  const opfs = await navigator.storage.getDirectory();
  try { await opfs.removeEntry("DemoVault", { recursive: true }); } catch { /* 처음 */ }
  const vault = await opfs.getDirectoryHandle("DemoVault", { create: true });
  const dirOf = async (parts) => {
    let dir = vault;
    for (const part of parts) dir = await dir.getDirectoryHandle(part, { create: true });
    return dir;
  };
  for (const rel of dirs) await dirOf(rel.split("/"));
  for (const [rel, { text, b64 }] of Object.entries(files)) {
    const parts = rel.split("/");
    const handle = await (await dirOf(parts.slice(0, -1))).getFileHandle(parts.at(-1), { create: true });
    const writable = await handle.createWritable();
    await writable.write(text ?? Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
    await writable.close();
  }
  const folder = await dirOf(["DEMO_100", "70-meetings"]);
  window.__picked = [];
  window.showDirectoryPicker = async (options = {}) => {
    window.__picked.push(options);
    return options.id === "meetings-folder" ? folder : vault;
  };
  return `OPFS DemoVault 준비(파일 ${Object.keys(files).length}개), 선택 창 대체 완료`;
}

// OPFS 안 파일 내용(확인용). readOpfs("DEMO_100/70-meetings/결제 연동.canvas")
async function readOpfs(rel) {
  let dir = await (await navigator.storage.getDirectory()).getDirectoryHandle("DemoVault");
  const parts = rel.split("/");
  for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part);
  return (await (await dir.getFileHandle(parts.at(-1))).getFile()).text();
}
