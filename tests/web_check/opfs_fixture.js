// 격리 후보 서버 Chrome 확인용(웹 번들에 넣지 않는다). 브라우저 도구의 eval 로 셸 페이지에 붙여 넣는다.
// 파일 선택 창은 자동화할 수 없어, OPFS(navigator.storage.getDirectory()) 아래 예제 폴더를 만들고
// window.showDirectoryPicker / showOpenFilePicker 를 그 핸들을 돌려주는 함수로 바꿔 끼운다(공통 계약 '확인용' 절).
// 예제 폴더 내용은 tests/js/web/plans_index.test.js 의 비교 폴더 일부와 같다.
(async () => {
  const FILES = {
    "2026-11-01 계획.md": "---\nstatus: 완료\nprogress: 100\nupdated: 2026-11-02\n---\n\n# 계획\n\n## 목표\n\n- [x] 끝난 일\n- [ ] 체크 안 한 일\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n[[2026-11-02 진행.md|진행 계획]] · [바깥](https://example.com) · [목표로](#목표)\n",
    "2026-11-02 진행.md": "---\nstatus: 진행중\nprogress: 40\nfeature: 외부 결재, 배포\n---\n# 진행\n- [x] a\n- [ ] b\n",
    "2026-11-03 할일.md": "---\nstatus: 할 일\nfeature: 배포\n---\n# 할일\n",
    "2026-11-04 매핑없음.md": "---\nstatus: 할 일\n---\n",
    "2026-11-05 보류.md": "---\nstatus: 보류\nprogress: 반쯤\nfeature: 배포\n---\n",
    "2026-10-19 인계.md": "# 인계\n\n- [ ] 남은 일\n",
    "00_10-plans_목록.md": "---\nstatus: 완료\n---\n",
  };
  const root = await navigator.storage.getDirectory();
  try { await root.removeEntry("10-plans", { recursive: true }); } catch { /* 처음 */ }
  const folder = await root.getDirectoryHandle("10-plans", { create: true });
  for (const [name, text] of Object.entries(FILES)) {
    const writable = await (await folder.getFileHandle(name, { create: true })).createWritable();
    await writable.write(text);
    await writable.close();
  }
  const sub = await folder.getDirectoryHandle("부속", { create: true });
  const w = await (await sub.getFileHandle("report.md", { create: true })).createWritable();
  await w.write("---\nstatus: 완료\n---\n");
  await w.close();
  window.__picked = [];
  window.showDirectoryPicker = async (options) => { window.__picked.push(options); return folder; };
  window.showOpenFilePicker = async (options) => { window.__picked.push(options); return [await folder.getFileHandle("2026-11-01 계획.md")]; };
  return "OPFS 예제 폴더 10-plans 준비, 선택 창 대체 완료";
})();
