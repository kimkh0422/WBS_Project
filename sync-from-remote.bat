@echo off
setlocal

rem --- Console encoding: UTF-8 (한글 표시용) ---
chcp 65001 > nul 2> nul

cd /d "%~dp0"

echo.
echo ============================================================
echo  주의: 로컬의 커밋되지 않은 변경과, 원격에 없는 로컬 커밋은
echo        모두 버려지고 현재 브랜치의 원격(origin) 상태로 맞춥니다.
echo ============================================================
echo.
set /p CONFIRM=계속하려면 Y 입력 후 Enter: 
if /i not "%CONFIRM%"=="Y" (
  echo 취소했습니다.
  pause
  exit /b 0
)

git fetch origin
if errorlevel 1 (
  echo git fetch 실패
  pause
  exit /b 1
)

for /f "delims=" %%i in ('git rev-parse --abbrev-ref HEAD 2^>nul') do set "BRANCH=%%i"
if not defined BRANCH (
  echo 현재 브랜치를 확인할 수 없습니다.
  pause
  exit /b 1
)
if /i "%BRANCH%"=="HEAD" (
  echo detached HEAD 상태입니다. 일반 브랜치로 checkout 한 뒤 다시 실행하세요.
  pause
  exit /b 1
)

git show-ref --verify --quiet "refs/remotes/origin/%BRANCH%"
if errorlevel 1 (
  echo 원격에 origin/%BRANCH% 가 없습니다. 브랜치 이름과 원격 설정을 확인하세요.
  pause
  exit /b 1
)

git reset --hard "origin/%BRANCH%"
if errorlevel 1 (
  echo git reset --hard 실패
  pause
  exit /b 1
)

echo.
echo 동기화 완료: 로컬이 origin/%BRANCH% 와 동일합니다.
echo 추적되지 않은(untracked) 파일은 그대로 둡니다. 필요하면 수동으로 git clean -fd 를 검토하세요.
echo.
pause
endlocal
