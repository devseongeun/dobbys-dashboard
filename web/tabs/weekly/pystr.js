// 로컬판(Python) 문자열 규칙을 JS 에서 그대로 쓰기 위한 도구. 주간 보고 파서·렌더러가 로컬판과 같은 결과를 내게 한다.
// - 공백: Python str.isspace()·re 의 \s 는 \x1c–\x1f·\x85 를 넣고 \ufeff(BOM)는 뺀다. JS \s·trim() 과 다르다.
// - 숫자: Python re 의 \d 는 유니코드 십진 숫자(\p{Nd}, 예: ５·٥)다. int() 도 그 숫자를 읽는다.
// - 줄: str.splitlines() 는 \n·\r 말고도 \v·\f·\x1c–\x1e·\x85·\u2028·\u2029 에서 끊는다.

export const WS = "\\t\\n\\x0b\\x0c\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
export const S = `[${WS}]`; // Python \s
export const D = "\\p{Nd}"; // Python \d (u 플래그와 함께 쓴다)

const STRIP = new RegExp(`^[${WS}]+|[${WS}]+$`, "gu");
export const strip = (value) => String(value).replace(STRIP, "");

// str.strip(chars): 양끝에서 chars 의 글자만 뗀다.
export function stripChars(value, chars) {
  const list = [...chars];
  const items = [...String(value)];
  let start = 0;
  let end = items.length;
  while (start < end && list.includes(items[start])) start++;
  while (end > start && list.includes(items[end - 1])) end--;
  return items.slice(start, end).join("");
}

const LINE_BREAK = /\r\n|[\n\r\x0b\x0c\x1c\x1d\x1e\x85\u2028\u2029]/;
export function splitlines(text) {
  if (text === "") return [];
  const lines = String(text).split(LINE_BREAK);
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

// Path.read_text(encoding='utf-8'): BOM 은 남기고(utf-8, utf-8-sig 아님) \r\n·\r 를 \n 으로 바꾼다. 깨진 바이트는 예외.
export function readText(bytes) {
  const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  return text.replace(/\r\n?/g, "\n");
}

// Python len(): 코드 포인트 수.
export const pyLen = (value) => [...String(value)].length;

// 유니코드 십진 숫자를 ASCII 로(Nd 글자는 0–9 가 연속 10자 묶음이라 구간 시작에서 센 거리 % 10 이 값이다).
const ND = /^\p{Nd}$/u;
export function asciiDigits(value) {
  return Array.from(String(value), (ch) => {
    if (!ND.test(ch) || (ch >= "0" && ch <= "9")) return ch;
    const cp = ch.codePointAt(0);
    let start = cp;
    while (ND.test(String.fromCodePoint(start - 1))) start--;
    return String((cp - start) % 10);
  }).join("");
}

export const pyInt = (digits) => Number(asciiDigits(digits));

// 코드 포인트 순 비교(Python 문자열 비교). JS 기본 비교는 UTF-16 단위라 BMP 밖 글자에서 다르다.
export function cmp(a, b) {
  const x = Array.from(String(a));
  const y = Array.from(String(b));
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const d = x[i].codePointAt(0) - y[i].codePointAt(0);
    if (d) return d < 0 ? -1 : 1;
  }
  return x.length === y.length ? 0 : x.length < y.length ? -1 : 1;
}

// html.escape(value, quote=False) / quote=True.
export const escapeText = (value) => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
export const esc = (value) => escapeText(value).replace(/"/g, "&quot;").replace(/'/g, "&#x27;");

// urllib.parse.quote(value) (safe='/').
export const quote = (value) => encodeURIComponent(String(value))
  .replace(/[!'()*]/g, (ch) => "%" + ch.charCodeAt(0).toString(16).toUpperCase())
  .replace(/%2F/g, "/");
