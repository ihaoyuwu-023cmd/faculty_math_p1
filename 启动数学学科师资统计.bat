@echo off
setlocal EnableExtensions
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command "& '%~dp0light-app\app\launch_app.ps1' -ProjectRoot '%~dp0light-app' -AppExe '%~dp0light-app\app\math-faculty-app.exe' -FallbackScript '%~dp0light-app\app\server.py' -ServiceBuildId '2.1.0-data-20260722' -ListenPort 8767 -MaxPort 8785"
exit /b %ERRORLEVEL%
