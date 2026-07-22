@echo off
setlocal EnableExtensions
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "& '%~dp0launch_app.ps1' -ProjectRoot '%~dp0..' -AppExe '%~dp0math-faculty-app.exe' -FallbackScript '%~dp0server.py' -ServiceBuildId '2.1.0-data-20260722' -ListenPort 8766 -MaxPort 8785"
set "EXIT_CODE=%ERRORLEVEL%"
if not "%EXIT_CODE%"=="0" (
  echo Math Faculty App failed to start. Exit code: %EXIT_CODE%
)
exit /b %EXIT_CODE%
