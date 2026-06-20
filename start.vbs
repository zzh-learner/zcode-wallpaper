' start.vbs — invisible launcher. Double-click THIS file (not start.bat) to run
' the whole setup with NO console windows: only the ZCode window appears.
'
' Why a .vbs: double-clicking a .bat always opens a console window. WScript
' runs this script with no window, and it launches start.bat hidden (0 = hidden
' window style). start.bat then launches the control-server hidden too (via
' PowerShell Start-Process -WindowStyle Hidden), and ZCode is the only visible
' window.
'
' To stop the control-center server later: just double-click start.vbs/start.bat
' again — it kills any old control-server node process before starting a new one.
' No need to hunt for it in Task Manager.
Set sh = CreateObject("WScript.Shell")
' 0 = hidden window. The .bat runs to completion (no pause — it self-closes).
sh.Run """" & Replace(WScript.ScriptFullName, "start.vbs", "start.bat") & """", 0, False
