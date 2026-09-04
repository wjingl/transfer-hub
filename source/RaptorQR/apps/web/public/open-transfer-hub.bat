@echo off
setlocal
cd /d "%~dp0"

rem 首选 Windows 自带 PowerShell（无 Python/Node 依赖），随机端口、自动打开浏览器。
where powershell >nul 2>nul
if %errorlevel%==0 (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0server.ps1"
  exit /b %errorlevel%
)

rem 备选：python3 静态服务（随机端口，不使用固定 8080）。
where python >nul 2>nul
if %errorlevel%==0 (
  for /f "delims=" %%P in ('powershell -NoProfile -Command "(Get-Random -Minimum 8765 -Maximum 8999)"') do set "PORT=%%P"
  start "" "http://127.0.0.1:%PORT%/"
  python -m http.server %PORT% --bind 127.0.0.1
  exit /b %errorlevel%
)

echo Transfer Hub needs PowerShell or Python to start.
echo Install any one of them, then run this file again.
pause
exit /b 1
