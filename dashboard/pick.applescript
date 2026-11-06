-- Finder 선택 창. 인자: 종류(dir|file|dirs), [처음 열 폴더]. 고른 경로를 줄마다 하나씩 돌려준다.
-- 취소하면 오류 -128 로 끝난다(dashboard/picker.py 가 취소로 본다).
-- kind 는 AppleScript 예약 속성이라 변수 이름으로 쓰면 -10006 으로 실패한다. pickKind·startAt 을 쓴다.
on run argv
	activate
	set pickKind to item 1 of argv
	set startAt to missing value
	if (count of argv) > 1 then set startAt to (POSIX file (item 2 of argv)) as alias
	if pickKind is "file" then
		if startAt is missing value then
			set picked to {choose file with prompt "파일을 고르세요"}
		else
			set picked to {choose file with prompt "파일을 고르세요" default location startAt}
		end if
	else if pickKind is "dirs" then
		if startAt is missing value then
			set picked to choose folder with prompt "폴더를 고르세요 (⌘ 누른 채 여러 개)" with multiple selections allowed
		else
			set picked to choose folder with prompt "폴더를 고르세요 (⌘ 누른 채 여러 개)" default location startAt with multiple selections allowed
		end if
	else
		if startAt is missing value then
			set picked to {choose folder with prompt "폴더를 고르세요"}
		else
			set picked to {choose folder with prompt "폴더를 고르세요" default location startAt}
		end if
	end if
	set out to {}
	repeat with f in picked
		set end of out to POSIX path of f
	end repeat
	set AppleScript's text item delimiters to linefeed
	return out as text
end run
