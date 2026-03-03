@echo off
setlocal enabledelayedexpansion

echo Scanning directory: %cd%
echo.

REM Use dir to list all files and folders, then filter
for /f "delims=" %%f in ('dir /s /b /a:-d ^| findstr /i /v "\\node_modules\\"') do (
    echo %%f
)

echo.
echo Scan complete!
pause
