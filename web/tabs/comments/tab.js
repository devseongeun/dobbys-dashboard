// comments 탭 등록 항목(web/tabs/manifest.js 가 WEB_TABS 에 넣는다). 로컬판 tabs/comments/__init__.py 의 TAB.describe() 와
// 같은 문구이고, 다른 점은 둘이다.
// - 기획서(TROMBONE) 주소(base) 칸이 없다. 대상은 서버 환경변수 TROMBONE_BASE 로만 정한다(브라우저가 주소를 정하면
//   사내망 열린 프록시가 된다). 서버에 없으면 탭이 '서버에 기획서 주소가 설정되지 않았다' 를 보인다.
// - 체크리스트 저장 폴더는 FSA 폴더 핸들이고, 브라우저가 직접 쓰므로 쓰기 권한(readwrite)으로 고른다.
export const COMMENTS_TAB = {
  id: "comments",
  label: "기획서 코멘트 현황",
  icon: "💬",
  src: "tabs/comments/",
  question: "웹 기획서에 답글이 달렸는지 궁금해요",
  summary: "기획서(TROMBONE)에 남긴 코멘트의 답글 현황을 봐요. 사내망(VPN)이 필요해요.",
  experimental: false,
  fields: [
    {
      key: "export_dir", label: "체크리스트 저장 폴더", kind: "dir", required: false, default: "",
      help: "비우면 MD로 내보내지 않습니다. 브라우저가 이 폴더에 체크리스트 md 를 직접 씁니다(쓰기 권한).",
      options: [], when: null, mode: "readwrite",
    },
  ],
  templates: [],
};
