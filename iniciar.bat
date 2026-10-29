@echo off
rem Abre el vigia de vuelos en segundo plano (sin ventana) y el panel en el navegador.
cd /d "%~dp0"
set PYTHONUTF8=1
start "" ".venv\Scripts\pythonw.exe" -X utf8 app.py %*
