// 웹 1단계 탭 목록. 항목 모양은 로컬판 dashboard/tab.py Tab.describe() 와 같고, src·templates[].url 은 상대 경로다.
// - 필드 kind: text · dir · file · dirs · choice. 웹에서 dir·file·dirs 값은 FSA 핸들(dirs 는 배열)이다.
// - 필드 realPath: true 면 폴더 칸 옆에 '실제 경로(경로 복사용, 선택)' 칸이 생기고 값은 <key>RealPath 로 저장된다.
// - 필드 accept: file 칸의 확장자 목록(예: [".xlsx"]), mode: 'read'(기본)·'readwrite'.
// - 항목 validate(settings) → {key: 문구} (선택, async 가능): 칸 검사를 통과한 뒤에만 돈다.
// 로컬판 순서는 wbs, plans 다. wbs 항목은 wbs-web 이 앞쪽에 더한다.
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

export const WEB_TABS = [PLANS];
