// 주간 보고 테스트 도구. support.js 의 가짜 폴더 핸들에 File 처럼 lastModified(ms)·size 를 붙인다(같은 주 초안 고르기가 쓴다).
import { statSync } from "node:fs";
import { dirHandle } from "./support.js";

export function statHandle(path) {
  const base = dirHandle(path);
  return {
    ...base,
    async *entries() {
      for await (const [name, entry] of base.entries()) {
        if (entry.kind !== "file") { yield [name, entry]; continue; }
        yield [name, {
          ...entry,
          async getFile() {
            const file = await entry.getFile();
            const info = statSync(entry.path);
            return { ...file, lastModified: info.mtimeMs, size: info.size };
          },
        }];
      }
    },
  };
}
