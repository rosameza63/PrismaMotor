@echo off
cd /d "%~dp0"
set "PORT=4173"
where node >nul 2>nul
if %errorlevel%==0 (
  node server-local.js
) else if exist "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" (
  "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" server-local.js
) else (
  echo No se encontro Node.js en este computador.
  echo Puedes usar el mismo iniciador local del proyecto Condominio o instalar Node.js.
)
pause
