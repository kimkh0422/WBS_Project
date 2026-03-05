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
echo Current version : v!CURRENT_VERSION!
echo New version     : v!NEW_VERSION!
echo ----------------------------------------

set /p COMMIT_MSG=Commit message: 
if "!COMMIT_MSG!"=="" set COMMIT_MSG=version update

git add .
git commit -m "v!NEW_VERSION!: !COMMIT_MSG!"

if %ERRORLEVEL% neq 0 (
    echo No changes to commit or commit failed.
    pause
    exit /b 1
)

git push origin main

if %ERRORLEVEL% equ 0 (
    echo !NEW_VERSION! > "%VERSION_FILE%"
    echo.
    echo Successfully deployed v!NEW_VERSION!
) else (
    echo Push failed.
)

pause
