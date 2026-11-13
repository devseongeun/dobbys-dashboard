// 웹 1단계 탭 목록. 항목 모양은 로컬판 dashboard/tab.py Tab.describe() 와 같고, src·templates[].url 은 상대 경로다.
// - 필드 kind: text · dir · file · dirs · choice. 웹에서 dir·file·dirs 값은 FSA 핸들(dirs 는 배열)이다.
// - 필드 realPath: true 면 폴더 칸 옆에 '실제 경로(경로 복사용, 선택)' 칸이 생기고 값은 <key>RealPath 로 저장된다.
// - 필드 accept: file 칸의 확장자 목록(예: [".xlsx"]), mode: 'read'(기본)·'readwrite'.
// - 항목 validate(settings) → {key: 문구} (선택, async 가능): 칸 검사를 통과한 뒤에만 돈다.
// 로컬판 순서는 wbs, assets, plans, comments, meetings, weekly 다(웹에 아직 없는 탭은 건너뛴다).
import { COMMENTS_TAB } from "./comments/tab.js";
import { WBS_TAB } from "./wbs/tab.js";

const ASSETS = {
  id: "assets",
  label: "의사결정 현황",
  icon: "🗂️",
  src: "tabs/assets/",
  question: "의사결정 기록과 현황을 파악하고 싶어요",
  summary: "문의 문서마다 회신 대상과 미결, 완료 상태를 한눈에 볼 수 있어요.",
  experimental: false,
  fields: [
    {
      key: "folder", label: "의사결정 문서 폴더", kind: "dir", required: true, default: "",
      help: "회신 대기 문의, 확인 요청 HTML과 참고 문서(설명, 분석, 설계, 점검표)가 있는 폴더. "
        + "기능 구분, 작성일은 각 HTML <head>의 <meta name=\"feature\">, <meta name=\"created\">에서 읽습니다. 예: …/90-assets",
      options: [], when: null, realPath: true,
    },
  ],
  templates: [
    {
      name: "의사결정_문서_제목.html",
      help: "기능 구분, 작성일 meta와 문의 현황 표가 들어 있습니다. 폴더에 넣고 제목, 기능 구분, 회신 대상, 문의 사항을 고쳐 쓰세요.",
      url: "tabs/assets/templates/의사결정_문서_제목.html",
    },
  ],
};

const PLANS = {
  id: "plans",
  label: "구현 진행 현황",
  icon: "🛠️",
  src: "tabs/plans/",
  question: "구현이 어디까지 진행됐는지 한눈에 보고 싶어요",
  summary: "구현 계획 md의 상태, 진행률, 체크 항목을 기능별로 모아 봐요.",
  experimental: false,
  fields: [
    {
      key: "folder", label: "구현 계획 폴더", kind: "dir", required: true, default: "",
      help: "계획 md가 쌓이는 폴더. 파일명은 'YYYY-MM-DD 제목.md', frontmatter status, progress, feature를 읽습니다. 예: …/10-plans",
      options: [], when: null, realPath: true,
    },
  ],
  templates: [
    {
      name: "YYYY-MM-DD 계획 제목.md",
      help: "frontmatter status, progress, feature, updated가 들어 있습니다. 폴더에 넣고 파일명의 YYYY-MM-DD를 작성일로, 제목과 값을 고쳐 쓰세요.",
      url: "tabs/plans/templates/YYYY-MM-DD 계획 제목.md",
    },
  ],
};

const WEEKLY = {
  id: "weekly",
  label: "주간 보고",
  icon: "📝",
  src: "tabs/weekly/",
  question: "주간 보고 초안을 챙기고 싶어요",
  summary: "주간 보고 폴더의 초안 md를 모아 봐요.",
  experimental: true,
  fields: [
    {
      key: "folders", label: "주간 보고 폴더", kind: "dirs", required: true, default: "",
      help: "주간 보고 초안 md가 쌓이는 폴더. 예전 보고 폴더가 따로 있으면 폴더 추가로 더 고르세요.",
      options: [], when: null,
    },
  ],
  templates: [
    {
      name: "YYYY-MM-DD 주간 보고.md",
      help: "AI 브리핑이 읽는 표준 섹션이 모두 들어 있습니다. 파일명의 YYYY-MM-DD를 회차 날짜로, 보고 기간과 각 섹션 내용을 고쳐 주간 보고 폴더에 넣으세요.",
      url: "tabs/weekly/templates/YYYY-MM-DD 주간 보고.md",
    },
  ],
};

export const WEB_TABS = [WBS_TAB, ASSETS, PLANS, COMMENTS_TAB, WEEKLY];
