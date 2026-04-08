@echo off
title YT-MP3 Server
echo ==================================================
echo   Starting YT-MP3 Local Server...
echo ==================================================
echo.
call conda activate yt-mp3-api
python "%~dp0server.py"
pause
