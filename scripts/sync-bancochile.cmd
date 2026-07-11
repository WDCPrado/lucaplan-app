@echo off
REM Wrapper para la tarea programada de Windows: sincroniza Banco de Chile (headless auto-login).
REM Requiere Postgres corriendo y las credenciales guardadas en la app. Loguea a .bancochile-sync.log.
cd /d "%~dp0.."
call pnpm sync:bank >> "%~dp0..\.bancochile-sync.log" 2>&1
