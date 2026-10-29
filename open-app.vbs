' Opens the Work Hub in the browser. If the app is not running yet, starts it first (hidden) and waits for it.
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
Function Up()
  On Error Resume Next
  Set h = CreateObject("MSXML2.ServerXMLHTTP.6.0")
  h.setTimeouts 1000, 1000, 1000, 1000
  h.open "GET", "http://localhost:4000/health", False
  h.send
  Up = (Err.Number = 0 And h.Status = 200)
  On Error GoTo 0
End Function
If Not Up() Then
  sh.Run "cmd /c node scripts\start.mjs", 7, False
  For i = 1 To 90
    WScript.Sleep 1000
    If Up() Then Exit For
  Next
End If
sh.Run "http://localhost:4000"
