@echo off
setlocal EnableDelayedExpansion
chcp 65001 > nul

set START_DIR=%~dp0
cd /d "%START_DIR%"

set VERSION_FILE=version.txt
if not exist "%VERSION_FILE%" (
    echo 0.0.0 > "%VERSION_FILE%"
)

set /p CURRENT_VERSION=<"%VERSION_FILE%"
set CURRENT_VERSION=!CURRENT_VERSION: =!

for /f "tokens=1,2,3 delims=." %%a in ("!CURRENT_VERSION!") do (
    set MAJOR=%%a
    set MINOR=%%b
    set PATCH=%%c
)

set /a PATCH+=1
set NEW_VERSION=!MAJOR!.!MINOR!.!PATCH!

echo ----------------------------------------
echo 현재 버전: v!CURRENT_VERSION!
echo 배포 버전: v!NEW_VERSION!
echo ----------------------------------------

set /p COMMIT_MSG="커밋 메시지를 입력하세요: "
if "!COMMIT_MSG!"=="" set COMMIT_MSG=버전 업데이트

git add .
git commit -m "v!NEW_VERSION!: !COMMIT_MSG!"

if !errorlevel! neq 0 (
    echo 변경사항이 없거나 커밋에 실패했습니다.
    pause
    exit /b !errorlevel!
)

git push origin main

if !errorlevel! equ 0 (
    echo !NEW_VERSION! > "%VERSION_FILE%"
    echo 배포가 성공적으로 완료되었습니다! (v!NEW_VERSION!)
) else (
    echo 푸시 중 오류가 발생했습니다.
)

pause
