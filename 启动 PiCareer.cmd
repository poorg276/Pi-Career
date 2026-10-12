@echo off
cd /d "%~dp0"
if exist "release\win-unpacked\PiCareer.exe" (
  start "" "release\win-unpacked\PiCareer.exe"
) else (
  echo Please build PiCareer first: npm run package
  pause
)
