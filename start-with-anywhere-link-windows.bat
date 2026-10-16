@echo off
rem Starts the Work Hub AND a free secure link that works from any phone, on any Wi-Fi or mobile data.
rem The link is shown in this window (https://....trycloudflare.com) and changes every time. Keep this window open.
cd /d "%~dp0"
set TUNNEL=1
node scripts\start.mjs
pause
