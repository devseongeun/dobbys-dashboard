// Chrome 확인 전용(웹 번들 아님). 파일 선택 창은 자동화할 수 없어, 브라우저 도구의 eval 로 이 함수를 페이지에 넣고
// showOpenFilePicker·showDirectoryPicker 를 OPFS(navigator.storage.getDirectory()) 아래 예제 파일 핸들로 바꿔 끼운다.
// 사용: installOpfsPicker({"DEMO_WBS.xlsx": "<base64>" | ArrayBuffer}) → 이후 pickFile 은 그 파일 핸들을 돌려준다.
// 목업 서버(wbs_mock_serve.py)에서는 fetch("api/check-file", {headers: {"X-Dobbys-Proxy": "1"}}) 의 arrayBuffer() 를 넘긴다.
async function installOpfsPicker(files) {
  const root = await navigator.storage.getDirectory();
  const dir = await root.getDirectoryHandle("wbs-check", { create: true });
  let last = null;
  for (const [name, b64] of Object.entries(files)) {
    const bytes = typeof b64 === "string" ? Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)) : new Uint8Array(b64);
    const handle = await dir.getFileHandle(name, { create: true });
    const writable = await handle.createWritable();
    await writable.write(bytes);
    await writable.close();
    last = handle;
  }
  window.showOpenFilePicker = async () => [last];
  window.showDirectoryPicker = async () => dir;
  return { dir: dir.name, file: last?.name };
}
