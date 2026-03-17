@echo off
chcp 65001 >nul
setlocal EnableExtensions EnableDelayedExpansion

echo ========================================
echo   Git 커밋 ^& 푸쉬
echo ========================================
echo.

REM Git 저장소 여부 확인
git rev-parse --is-inside-work-tree >nul 2>&1
if errorlevel 1 (
  echo 오류: 현재 폴더가 Git 저장소가 아닙니다.
  echo.
  pause
  exit /b 1
)

REM 현재 브랜치 확인
for /f "delims=" %%i in ('git branch --show-current 2^>nul') do set "BRANCH=%%i"
if "%BRANCH%"=="" (
  echo 오류: 현재 브랜치를 확인할 수 없습니다.
  echo.
  pause
  exit /b 1
)

echo 현재 브랜치: %BRANCH%
echo.

REM 변경사항 여부 확인
for /f %%i in ('git status --porcelain 2^>nul ^| find /c /v ""') do set "CHANGES=%%i"
if "%CHANGES%"=="0" (
  echo 변경사항이 없습니다. (커밋할 내용 없음)
  echo.
  pause
  exit /b 0
)

echo 현재 변경사항:
git status --porcelain
echo.

REM 커밋 메시지 입력 (인자 우선, 없으면 프롬프트)
set "MSG=%*"
if "%MSG%"=="" (
  set /p MSG=커밋 메시지 입력: 
)
if "%MSG%"=="" (
  echo 오류: 커밋 메시지가 비어있습니다.
  echo.
  pause
  exit /b 1
)

echo.
echo [1/3] git add -A
git add -A
if errorlevel 1 (
  echo 오류: git add 실패
  echo.
  pause
  exit /b 1
)

echo.
echo [2/3] git commit -m "%MSG%"
git commit -m "%MSG%"
if errorlevel 1 (
  echo 오류: git commit 실패 (훅/충돌/메시지 등 확인)
  echo.
  pause
  exit /b 1
)

echo.
echo [3/3] git push origin %BRANCH%
git push origin %BRANCH%
if errorlevel 1 (
  echo 오류: git push 실패 (로그인/권한/충돌 등 확인)
  echo.
  pause
  exit /b 1
)

echo.
echo ========================================
echo   완료
echo ========================================
pause

