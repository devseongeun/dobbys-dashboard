"""사이드바 순서대로 탭을 모은다. 탭 패키지마다 TAB 하나를 내보낸다."""
from tabs.assets import TAB as ASSETS
from tabs.meetings import TAB as MEETINGS
from tabs.plans import TAB as PLANS

ALL_TABS = (ASSETS, PLANS, MEETINGS)
