@echo off
rem Cierra el vigia de vuelos.
cd /d "%~dp0"
if not exist vigia.pid (echo El vigia no esta corriendo. & pause & exit /b)
set /p PID=<vigia.pid
taskkill /PID %PID% /F
del vigia.pid
pause
