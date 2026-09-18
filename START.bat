@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul || (
  echo Node.js 22 or newer is required.
  pause
  exit /b 1
)

node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 22 ? 0 : 1)" >nul 2>nul || (
  echo Node.js 22 or newer is required.
  node --version
  pause
  exit /b 1
)

if not exist node_modules\express\package.json goto install_dependencies
if not exist node_modules\impit\package.json goto install_dependencies
goto start_server

:install_dependencies
echo Installing dependencies...
call npm install --no-audit --no-fund
if errorlevel 1 (
  echo Dependency installation failed.
  pause
  exit /b 1
)

:start_server
start "" http://127.0.0.1:3000
npm start
pause
