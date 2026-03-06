@echo off
setlocal EnableDelayedExpansion

rem --- Console encoding setup (Korean input friendly) ---
for /f %%C in ('powershell -NoProfile -Command "[Console]::InputEncoding.CodePage"') do set "ORIG_CP=%%C"
chcp 949 > nul 2> nul
if %ERRORLEVEL% neq 0 (
    rem If 949 not available, keep original
    chcp %ORIG_CP% > nul 2> nul
)

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

rem --- Read commit message in Unicode (supports Korean IME) ---
setlocal DisableDelayedExpansion
for /f "usebackq delims=" %%M in (`powershell -NoProfile -Command "$m = Read-Host 'Commit message'; if ([string]::IsNullOrWhiteSpace($m)) { $m = 'version update' }; $m"`) do set "COMMIT_MSG=%%M"
endlocal & set "COMMIT_MSG=%COMMIT_MSG%"

rem --- Bump version file before commit (so commit includes it) ---
echo !NEW_VERSION! > "%VERSION_FILE%"

rem --- Write commit message to UTF-8 file to avoid cmd quoting/encoding issues ---
for /f "usebackq delims=" %%F in (`powershell -NoProfile -Command "$msg = 'v%NEW_VERSION%: %COMMIT_MSG%'; $p = [IO.Path]::GetTempFileName(); [IO.File]::WriteAllText($p, $msg, (New-Object Text.UTF8Encoding($false))); Write-Output $p"`) do set "MSG_FILE=%%F"

git add .
git -c i18n.commitEncoding=utf-8 -c i18n.logOutputEncoding=utf-8 commit -F "%MSG_FILE%"
del /q "%MSG_FILE%" > nul 2> nul

if %ERRORLEVEL% neq 0 (
    echo No changes to commit or commit failed.
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
