' Starts the Work Hub in a minimized window (used by install-autostart-windows.bat).
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
sh.Run "cmd /c node scripts\start.mjs", 7, False
