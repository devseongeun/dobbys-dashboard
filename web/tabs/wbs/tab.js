// wbs 탭 등록 항목(web/tabs/manifest.js 가 WEB_TABS 맨 앞에 넣는다). 로컬판 tabs/wbs/__init__.py 의 TAB.describe() 와
// 같은 필드·문구이고, workbook 은 웹에서 파일 핸들(fsa.pickFile)이다. validate 는 로컬판 _validate 이식.
import { cleanDomain, DOMAIN_RE, PROJECT_RE } from "./js/jira.js";
import { readWbs, readFailure, XlsxError } from "./js/xlsx.js";

export const DEFAULT_SHEET = "TROMBONE_v4.0.0_WBS(작업)";
const WBS = "wbs";
const JIRA = "jira";
const field = (key, label, kind, extra = {}) => ({
  key, label, kind, required: false, default: "", help: "", options: [], when: null, ...extra,
});

// 저장할 때 셸이 부른다. {필드 key: 오류 문구}. 엑셀은 브라우저가 핸들로 직접 읽는다(서버로 보내지 않음).
export async function validate(settings, io = {}) {
  const errors = {};
  if (!DOMAIN_RE.test(cleanDomain(settings.jira_domain))) {
    errors.jira_domain = "도메인 형식이 아닙니다(예: example.atlassian.net)";
  }
  if (!PROJECT_RE.test(settings.jira_project || "")) {
    errors.jira_project = "프로젝트 키는 영문 대문자로 시작합니다(예: PROJ)";
  }
  if ((settings.mode || WBS) !== WBS) return errors;
  const handle = settings.workbook;
  if (!handle || typeof handle.getFile !== "function") return errors; // 필수 검사는 셸이 한다.
  try {
    const file = await handle.getFile();
    await readWbs(new Uint8Array(await file.arrayBuffer()), settings.sheet || DEFAULT_SHEET, settings.owner || "", io);
  } catch (err) {
    if (err instanceof XlsxError) errors[err.field] = err.message;
    else errors.workbook = readFailure(err);
  }
  return errors;
}

export const WBS_TAB = {
  id: "wbs", label: "WBS·Jira", icon: "📅", src: "tabs/wbs/",
  question: "WBS나 Jira 일정을 한눈에 보고 관리하고 싶어요",
  summary: "WBS 엑셀 기준이나 Jira 기준 중 하나를 골라 내 담당 일정을 모아요. WBS 기준이면 Jira 티켓과 연결해 Jira 일정과 진행 상황으로 보여 줘요.",
  experimental: false,
  fields: [
    field("mode", "일정 기준", "choice", {
      default: WBS, options: [[WBS, "WBS 엑셀 기준"], [JIRA, "Jira 기준"]],
      help: "WBS 엑셀 기준은 엑셀의 내 행으로 일정을 만들고 Jira에 로그인하면 Jira 값으로 덮습니다. " +
        "Jira 기준은 엑셀 없이 Jira의 내 담당 이슈만 봅니다.",
    }),
    field("workbook", "WBS 엑셀 파일", "file", {
      required: true, help: "팀 WBS .xlsx 파일.", when: ["mode", WBS],
      accept: { "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"] },
    }),
    field("owner", "담당자 이름", "text", {
      required: true, help: "엑셀 '담당자' 열의 내 이름. '이름 외 N명' 행도 포함합니다.", when: ["mode", WBS],
    }),
    field("sheet", "시트 이름", "text", { default: DEFAULT_SHEET, when: ["mode", WBS] }),
    field("jira_domain", "Jira 도메인", "text", {
      required: true, help: "예: yourcompany.atlassian.net. 탭 안에서 로그인합니다.",
    }),
    field("jira_project", "Jira 프로젝트 키", "text", { required: true, help: "예: PROJ" }),
  ],
  templates: [],
  validate,
};
