@echo off
title YT-MP3 Server - Stopping
echo ==================================================
echo   Stopping YT-MP3 Server...
echo ==================================================
echo.
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":5000" ^| findstr "LISTENING"') do (
    echo   Killing process PID: %%a
    taskkill /F /PID %%a >nul 2>&1
)
echo   Server stopped.
echo ==================================================
timeout /t 3 >nul
