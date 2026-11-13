// 웹 comments 탭 Chrome 확인 전용(웹 번들 아님). 브라우저 도구의 eval 로 셸 페이지에 붙여 넣는다.
// 폴더 선택 창은 자동화할 수 없어, OPFS(navigator.storage.getDirectory()) 아래 빈 예제 폴더 'comments-export' 를 만들고
// window.showDirectoryPicker 를 그 핸들을 돌려주는 함수로 바꿔 끼운다(공통 계약 '확인용' 절). 서버는 trombone_mock_serve.py.
// 체크리스트 md 는 이 OPFS 폴더에 쓰이고, __commentsCheck.files() 로 이름·내용을 읽어 본다.
// 탭 iframe 의 confirm·prompt 는 자동화 도구를 멈추게 하므로 __commentsCheck.answer(값들) 로 미리 답을 정해 둔다.
(async () => {
  const root = await navigator.storage.getDirectory();
  try { await root.removeEntry("comments-export", { recursive: true }); } catch { /* 처음 */ }
  const folder = await root.getDirectoryHandle("comments-export", { create: true });
  window.__picked = [];
  window.showDirectoryPicker = async (options) => { window.__picked.push(options); return folder; };
  window.showOpenFilePicker = async () => { throw Object.assign(new Error("이 확인에서는 파일을 고르지 않는다"), { name: "AbortError" }); };
  const frame = () => [...document.querySelectorAll("iframe")].find((f) => f.src.includes("tabs/comments/"))?.contentWindow;
  window.__commentsCheck = {
    // answer(["상", "출시 전"]) → 다음 prompt 들이 차례로 그 값을 돌려준다. confirm 은 늘 true.
    answer(values = []) {
      const win = frame();
      const queue = [...values];
      win.confirm = () => true;
      win.prompt = () => (queue.length ? queue.shift() : null);
      win.alert = (message) => { win.__alerts = [...(win.__alerts ?? []), String(message)]; };
      return "iframe 대화상자 대체 완료";
    },
    async files() {
      const out = {};
      for await (const [name, handle] of folder.entries()) if (handle.kind === "file") out[name] = await (await handle.getFile()).text();
      return out;
    },
  };
  return "OPFS 예제 폴더 comments-export 준비, 선택 창 대체 완료";
})();
