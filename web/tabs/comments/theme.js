// 테마는 그리기 전에 정한다(깜빡임 방지). 로컬판 index.html 머리의 인라인 스크립트를 옮겼다(웹 CSP 는 인라인 스크립트를 막는다).
// 기본은 라이트, [🌙 다크]로 고른 값은 이 브라우저에 기억한다.
try { if (localStorage.getItem("spec-comments:theme") === "dark") document.documentElement.dataset.theme = "dark"; } catch (e) { /* 저장소가 막힌 창 */ }
