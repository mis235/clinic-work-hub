@echo off
rem Run this ONCE (double-click). It lets phones on the clinic Wi-Fi reach the Work Hub on this computer.
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo Asking Windows for permission... click YES on the next box.
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
netsh advfirewall firewall delete rule name="Clinic Work Hub phones" >nul 2>&1
netsh advfirewall firewall add rule name="Clinic Work Hub phones" dir=in action=allow protocol=TCP localport=4000,4443 profile=any
echo.
echo Done. Phones on the same Wi-Fi can now open the app.
echo Now start the app (start-windows.bat) and use the https address it shows.
echo.
pause
