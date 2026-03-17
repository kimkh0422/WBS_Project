@echo off
chcp 65001 >nul
echo ========================================
echo   Vercel 배포
echo ========================================
echo.

echo [0/3] Git 사용자 확인...
git config user.name >nul 2>&1
if errorlevel 1 (
  echo 오류: Git user.name이 설정되지 않았습니다.
  echo.
  echo 다음 명령어를 실행한 후 다시 시도하세요:
  echo   git config --global user.name "Your Name"
  echo   git config --global user.email "your@email.com"
  echo.
  echo   ^(user.email은 Vercel 계정 이메일과 일치해야 합니다^)
  echo.
  pause
  exit /b 1
)
git config user.email >nul 2>&1
if errorlevel 1 (
  echo 오류: Git user.email이 설정되지 않았습니다.
  echo.
  echo 다음 명령어를 실행한 후 다시 시도하세요:
  echo   git config --global user.name "Your Name"
  echo   git config --global user.email "your@email.com"
  echo.
  echo   ^(user.email은 Vercel 계정 이메일과 일치해야 합니다^)
  echo.
  pause
  exit /b 1
)
for /f "delims=" %%i in ('git config user.name 2^>nul') do echo   user.name: %%i
for /f "delims=" %%i in ('git config user.email 2^>nul') do echo   user.email: %%i
echo   ^(Vercel 계정 이메일과 일치해야 합니다^)
echo.

echo [1/3] 의존성 설치...
call npm install
if errorlevel 1 (
  echo 오류: npm install 실패
  pause
  exit /b 1
)
echo.

echo [2/3] 빌드...
call npm run build
if errorlevel 1 (
  echo 오류: 빌드 실패
  pause
  exit /b 1
)
echo.


echo [3/3] Vercel 배포...
set "CI_OLD=%CI%"
set CI=1
call npx vercel --prod
if defined CI_OLD (set "CI=%CI_OLD%") else (set "CI=")
if errorlevel 1 (
  echo 오류: Vercel 배포 실패
  pause
  exit /b 1
)

echo.
echo ========================================
echo   배포 완료
echo ========================================
pause
