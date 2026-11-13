// 주간 보고 탭 Chrome 확인용(웹 번들에 넣지 않는다). 브라우저 도구의 eval 로 셸 페이지에 붙여 넣는다.
// 파일 선택 창은 자동화할 수 없어, OPFS(navigator.storage.getDirectory()) 아래 예제 폴더 여러 개를 만들고
// window.showDirectoryPicker 를 부를 때마다 다음 폴더 핸들을 돌려주게 바꿔 끼운다('폴더 추가'를 두 번 누르면 두 폴더).
// 사용: installWeeklyFolders({"80-weekly": {"<파일명>": "<내용>"}, "80-weekly-old": {...}}).
// 내용은 tests/web_check/weekly_fixture_data.py <mock_data 의 80-weekly> 가 JSON 으로 만든다. eval 에 붙이기 길면
// `… | gzip -9 | base64` 로 줄여 넘기고 페이지에서 DecompressionStream("gzip") 으로 풀어 JSON.parse 한다.
async function installWeeklyFolders(folders) {
  const root = await navigator.storage.getDirectory();
  const handles = [];
  for (const [folder, files] of Object.entries(folders)) {
    try { await root.removeEntry(folder, { recursive: true }); } catch { /* 처음 */ }
    const dir = await root.getDirectoryHandle(folder, { create: true });
    for (const [name, text] of Object.entries(files)) {
      const writable = await (await dir.getFileHandle(name, { create: true })).createWritable();
      await writable.write(text);
      await writable.close();
    }
    handles.push(dir);
  }
  let next = 0;
  window.__picked = [];
  window.showDirectoryPicker = async (options) => { window.__picked.push(options); return handles[next++ % handles.length]; };
  return handles.map((h) => h.name);
}
