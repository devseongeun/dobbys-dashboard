// 테스트 전용 작은 XML 파서. bun 에는 DOMParser 가 없어 xlsx.js 가 쓰는 DOM 부분집합만 흉내 낸다
// (getElementsByTagNameNS·getAttribute·getAttributeNS·textContent·childNodes). 브라우저 번들에는 넣지 않는다.
// 잘못된 XML(닫히지 않은 태그·잘린 문서)은 throw — DOMParser 의 parsererror 와 같은 역할.

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decode(text) {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (whole, name) => {
    if (name[0] === "#") {
      return String.fromCodePoint(name[1] === "x" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10));
    }
    if (!(name in ENTITIES)) throw new Error("알 수 없는 엔티티: " + whole);
    return ENTITIES[name];
  });
}

class Node {
  constructor(nodeType) {
    this.nodeType = nodeType;
    this.childNodes = [];
  }

  get textContent() {
    if (this.nodeType === 3) return this.data;
    return this.childNodes.map((c) => c.textContent).join("");
  }

  getElementsByTagNameNS(ns, local) {
    const out = [];
    const walk = (node) => {
      for (const child of node.childNodes) {
        if (child.nodeType !== 1) continue;
        if ((ns === "*" || child.namespaceURI === ns) && (local === "*" || child.localName === local)) out.push(child);
        walk(child);
      }
    };
    walk(this);
    return out;
  }

  getElementsByTagName(name) {
    const out = [];
    const walk = (node) => {
      for (const child of node.childNodes) {
        if (child.nodeType !== 1) continue;
        if (child.tagName === name) out.push(child);
        walk(child);
      }
    };
    walk(this);
    return out;
  }
}

class Element extends Node {
  constructor(tagName, attrs, scope) {
    super(1);
    this.tagName = tagName;
    this.attrs = attrs;
    const [prefix, local] = tagName.includes(":") ? tagName.split(":") : [null, tagName];
    this.localName = local;
    this.namespaceURI = scope[prefix ?? ""] ?? null;
    this.scope = scope;
  }

  getAttribute(name) {
    return Object.hasOwn(this.attrs, name) ? this.attrs[name] : null;
  }

  getAttributeNS(ns, local) {
    for (const [name, value] of Object.entries(this.attrs)) {
      if (!name.includes(":")) continue;
      const [prefix, l] = name.split(":");
      if (prefix !== "xmlns" && l === local && this.scope[prefix] === ns) return value;
    }
    return null;
  }
}

const NAME = "[A-Za-z_][\\w.:-]*";
const ATTR = new RegExp(`\\s+(${NAME})\\s*=\\s*("([^"]*)"|'([^']*)')`, "y");

export function parseXml(text) {
  const doc = new Node(9);
  const stack = [doc];
  const scopes = [{ xml: "http://www.w3.org/XML/1998/namespace" }];
  let i = 0;
  let sawRoot = false;
  while (i < text.length) {
    const lt = text.indexOf("<", i);
    const chunk = text.slice(i, lt < 0 ? text.length : lt);
    if (chunk) {
      if (stack.length === 1) {
        if (chunk.trim()) throw new Error("루트 밖 글자");
      } else {
        const node = new Node(3);
        node.data = decode(chunk);
        stack.at(-1).childNodes.push(node);
      }
    }
    if (lt < 0) break;
    if (text.startsWith("<?", lt)) {
      const end = text.indexOf("?>", lt);
      if (end < 0) throw new Error("처리 명령이 닫히지 않았다");
      i = end + 2;
    } else if (text.startsWith("<!--", lt)) {
      const end = text.indexOf("-->", lt);
      if (end < 0) throw new Error("주석이 닫히지 않았다");
      i = end + 3;
    } else if (text.startsWith("<![CDATA[", lt)) {
      const end = text.indexOf("]]>", lt);
      if (end < 0 || stack.length === 1) throw new Error("CDATA 오류");
      const node = new Node(3);
      node.data = text.slice(lt + 9, end);
      stack.at(-1).childNodes.push(node);
      i = end + 3;
    } else if (text.startsWith("</", lt)) {
      const match = new RegExp(`</(${NAME})\\s*>`, "y");
      match.lastIndex = lt;
      const m = match.exec(text);
      if (!m || stack.length === 1 || stack.at(-1).tagName !== m[1]) throw new Error("닫는 태그가 맞지 않는다");
      stack.pop();
      scopes.pop();
      i = match.lastIndex;
    } else {
      const open = new RegExp(`<(${NAME})`, "y");
      open.lastIndex = lt;
      const m = open.exec(text);
      if (!m) throw new Error("태그 이름이 없다");
      if (stack.length === 1 && sawRoot) throw new Error("루트가 둘이다");
      let at = open.lastIndex;
      const attrs = {};
      for (;;) {
        ATTR.lastIndex = at;
        const a = ATTR.exec(text);
        if (!a) break;
        if (Object.hasOwn(attrs, a[1])) throw new Error("속성이 겹친다");
        attrs[a[1]] = decode(a[3] ?? a[4]);
        at = ATTR.lastIndex;
      }
      const close = /\s*(\/?)>/y;
      close.lastIndex = at;
      const c = close.exec(text);
      if (!c) throw new Error("태그가 닫히지 않았다");
      const scope = { ...scopes.at(-1) };
      for (const [name, value] of Object.entries(attrs)) {
        if (name === "xmlns") scope[""] = value;
        else if (name.startsWith("xmlns:")) scope[name.slice(6)] = value;
      }
      const el = new Element(m[1], attrs, scope);
      stack.at(-1).childNodes.push(el);
      if (stack.length === 1) sawRoot = true;
      if (!c[1]) {
        stack.push(el);
        scopes.push(scope);
      }
      i = close.lastIndex;
    }
  }
  if (stack.length !== 1 || !sawRoot) throw new Error("문서가 끝나지 않았다");
  return doc;
}
