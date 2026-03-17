@echo off
set /p MSG=commit message: 
git add -A && git commit -m "%MSG%" && git push

