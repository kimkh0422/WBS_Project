@echo off
setlocal EnableDelayedExpansion

rem --- Console encoding: UTF-8 (배치 파일 한글 표시용) ---
chcp 65001 > nul 2> nul

set START_DIR=%~dp0
cd /d "%START_DIR%"

rem --- Read commit message via Notepad (한글 IME 지원) ---
set "MSG_TMP=%TEMP%\wbs_push_msg_%RANDOM%.txt"
powershell -NoProfile -Command "[IO.File]::WriteAllText('%MSG_TMP%', 'version update', [Text.UTF8Encoding]::new($false))"
echo.
echo [Notepad에서 커밋 메시지를 입력한 뒤 저장하고 닫으세요]
start /wait notepad "%MSG_TMP%"

rem --- Build commit message file from Notepad content (한글 깨짐 방지) ---
for /f "usebackq delims=" %%F in (`powershell -NoProfile -Command "$c=[IO.File]::ReadAllText('%MSG_TMP%', [Text.Encoding]::UTF8).Trim(); $m=($c -split [char]10)[0].Trim(); if ([string]::IsNullOrWhiteSpace($m)) {$m='version update'}; $p=[IO.Path]::GetTempFileName(); [IO.File]::WriteAllText($p, $m, [Text.UTF8Encoding]::new($false)); Write-Output $p"`) do set "MSG_FILE=%%F"
del /q "%MSG_TMP%" > nul 2> nul

git add .
git -c i18n.commitEncoding=utf-8 -c i18n.logOutputEncoding=utf-8 commit -F "%MSG_FILE%"
del /q "%MSG_FILE%" > nul 2> nul

if %ERRORLEVEL% neq 0 (
    echo No changes to commit or commit failed.
    pause
    exit /b 1
)

rem --- Read bumped version (hook updates package.json/CHANGELOG/version.txt) ---
set VERSION_FILE=version.txt
set NEW_VERSION=
if exist "%VERSION_FILE%" (
  set /p NEW_VERSION=<"%VERSION_FILE%"
  set NEW_VERSION=!NEW_VERSION: =!
  set NEW_VERSION=!NEW_VERSION:v=!
)
if "!NEW_VERSION!"=="" (
  set NEW_VERSION=unknown
)

rem --- Today's date (local) for console banner ---
set "RELEASE_DATE="
for /f "usebackq delims=" %%D in (`powershell -NoProfile -Command "(Get-Date).ToString('yyyy-MM-dd')"`) do set "RELEASE_DATE=%%D"
set "RELEASE_DATE_KO="
for /f "usebackq delims=" %%D in (`powershell -NoProfile -Command "(Get-Date).ToString('yyyy년 M월 d일', [Globalization.CultureInfo]::GetCultureInfo('ko-KR'))"`) do set "RELEASE_DATE_KO=%%D"

echo ----------------------------------------
echo Released version : v!NEW_VERSION!
echo Release date     : !RELEASE_DATE! ^(!RELEASE_DATE_KO!^)
echo ----------------------------------------

rem --- Remove stale lock file if exists (e.g. from crashed git process) ---
if exist ".git\index.lock" (
    echo Removing stale .git\index.lock...
    del /q ".git\index.lock" > nul 2> nul
)

rem --- Pull with rebase to integrate remote changes before push ---
echo Pulling remote changes...
git pull --rebase origin main
if %ERRORLEVEL% neq 0 (
    echo Pull failed. Resolve conflicts if any, then run: git push origin main
    pause
    exit /b 1
)

git push origin main

if %ERRORLEVEL% equ 0 (
    echo.
    echo Successfully deployed v!NEW_VERSION! ^(!RELEASE_DATE!^)
) else (
    echo Push failed.
)

pause
