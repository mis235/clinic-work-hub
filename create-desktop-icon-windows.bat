@echo off
rem Run ONCE. Puts a "Dr. Nishita's Clinic" icon on the Desktop. Clicking it opens the app (and starts it if needed).
cd /d "%~dp0"
powershell -NoProfile -Command "$s=(New-Object -COM WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Desktop')+'\Dr. Nishita''s Clinic.lnk'); $s.TargetPath='wscript.exe'; $s.Arguments='\"%~dp0open-app.vbs\"'; $s.WorkingDirectory='%~dp0'; $s.IconLocation='%~dp0clinic-icon.ico'; $s.Save()"
echo.
echo Done. Look on the Desktop for the icon "Dr. Nishita's Clinic". Click it to open the app.
pause
