@echo off
setlocal EnableDelayedExpansion

rem --- Console encoding: UTF-8 (배치 파일 한글 표시용) ---
chcp 65001 > nul 2> nul

set START_DIR=%~dp0
cd /d "%START_DIR%"

set VERSION_FILE=version.txt
if not exist "%VERSION_FILE%" (
    echo 0.0.0 > "%VERSION_FILE%"
)

set /p CURRENT_VERSION=<"%VERSION_FILE%"
set CURRENT_VERSION=!CURRENT_VERSION: =!
set CURRENT_VERSION=!CURRENT_VERSION:v=!

for /f "tokens=1,2,3 delims=." %%a in ("!CURRENT_VERSION!") do (
    set MAJOR=%%a
    set MINOR=%%b
    set PATCH=%%c
)

set /a PATCH+=1
set NEW_VERSION=!MAJOR!.!MINOR!.!PATCH!

echo ----------------------------------------
echo Current version : v!CURRENT_VERSION!
echo New version     : v!NEW_VERSION!
echo ----------------------------------------

rem --- Read commit message via Notepad (한글 IME 지원) ---
set "MSG_TMP=%TEMP%\wbs_push_msg_%RANDOM%.txt"
powershell -NoProfile -Command "[IO.File]::WriteAllText('%MSG_TMP%', 'version update', [Text.UTF8Encoding]::new($false))"
echo.
echo [Notepad에서 커밋 메시지를 입력한 뒤 저장하고 닫으세요]
start /wait notepad "%MSG_TMP%"

rem --- Bump version file before commit (so commit includes it) ---
echo !NEW_VERSION! > "%VERSION_FILE%"

rem --- Build commit message file from Notepad content (한글 깨짐 방지) ---
for /f "usebackq delims=" %%F in (`powershell -NoProfile -Command "$c=[IO.File]::ReadAllText('%MSG_TMP%', [Text.Encoding]::UTF8).Trim(); $m=($c -split [char]10)[0].Trim(); if ([string]::IsNullOrWhiteSpace($m)) {$m='version update'}; $msg='v%NEW_VERSION%: '+$m; $p=[IO.Path]::GetTempFileName(); [IO.File]::WriteAllText($p, $msg, [Text.UTF8Encoding]::new($false)); Write-Output $p"`) do set "MSG_FILE=%%F"
del /q "%MSG_TMP%" > nul 2> nul

git add .
git -c i18n.commitEncoding=utf-8 -c i18n.logOutputEncoding=utf-8 commit -F "%MSG_FILE%"
del /q "%MSG_FILE%" > nul 2> nul

if %ERRORLEVEL% neq 0 (
    echo No changes to commit or commit failed.
    pause
    exit /b 1
)

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
    echo Successfully deployed v!NEW_VERSION!
) else (
    echo Push failed.
)

pause
