@echo off
title YT-MP3 - Install Native Messaging Host
echo ==================================================
echo   YT-MP3 Native Messaging Host Installer
echo ==================================================
echo.
echo This registers the native host so Chrome can
echo auto-start the server when you request a conversion.
echo.
echo STEP 1: Find your extension ID
echo   1. Open chrome://extensions
echo   2. Find "YouTube to MP3 Downloader"
echo   3. Copy the ID (looks like: abcdefghijklmnop...)
echo.
set /p EXT_ID="Paste your extension ID here: "

if "%EXT_ID%"=="" (
    echo ERROR: No extension ID provided.
    pause
    exit /b 1
)

set HOST_NAME=com.ytmp3.server
set MANIFEST_PATH=%~dp0native_host_manifest.json
set BAT_PATH=%~dp0native_host.bat

:: Convert backslashes to forward slashes for JSON
set BAT_PATH_JSON=%BAT_PATH:\=/%

echo.
echo STEP 2: Writing manifest...

(
echo {
echo   "name": "%HOST_NAME%",
echo   "description": "YT-MP3 Server Launcher",
echo   "path": "%BAT_PATH_JSON%",
echo   "type": "stdio",
echo   "allowed_origins": [
echo     "chrome-extension://%EXT_ID%/"
echo   ]
echo }
) > "%MANIFEST_PATH%"

echo   Manifest written to: %MANIFEST_PATH%

echo.
echo STEP 3: Registering in Windows Registry...

:: Use HKCU so no admin rights needed
reg add "HKCU\Software\Google\Chrome\NativeMessagingHosts\%HOST_NAME%" /ve /t REG_SZ /d "%MANIFEST_PATH%" /f >nul 2>&1

if %ERRORLEVEL%==0 (
    echo   Registry entry added successfully.
) else (
    echo   ERROR: Failed to add registry entry.
    pause
    exit /b 1
)

echo.
echo ==================================================
echo   Installation complete!
echo.
echo   Now restart Chrome and the extension will
echo   auto-start the server when you convert.
echo ==================================================
echo.
pause
