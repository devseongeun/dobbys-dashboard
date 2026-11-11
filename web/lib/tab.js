// 탭 화면(iframe)이 쓰는 문맥. 탭 iframe 은 셸과 같은 출처라 IndexedDB 를 직접 읽는다.
import { loadConfig, tabState } from "./store.js";

// {settings: 이 탭의 저장된 설정(없으면 null), state: tabState(tabId), project}. 설정을 읽어야 해서 Promise 다.
export async function tabContext(tabId) {
  const config = await loadConfig();
  return { settings: config?.tabs?.[tabId] ?? null, state: tabState(tabId), project: config?.project ?? "" };
}
