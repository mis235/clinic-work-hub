@echo off
rem Run ONCE. Makes the Work Hub start by itself every time this computer starts, and keeps the PC from sleeping.
cd /d "%~dp0"
powershell -NoProfile -Command "$s=(New-Object -COM WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Startup')+'\Clinic Work Hub.lnk'); $s.TargetPath='wscript.exe'; $s.Arguments='\"%~dp0run-hidden.vbs\"'; $s.WorkingDirectory='%~dp0'; $s.Save()"
powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0
echo.
echo Done. The Work Hub will now start by itself when this computer starts (minimized).
echo The computer will no longer go to sleep while plugged in.
echo Starting it now...
wscript.exe "%~dp0run-hidden.vbs"
echo.
pause
