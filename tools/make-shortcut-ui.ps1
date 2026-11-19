# AgentPong: ярлык "Глосс Скряга" на рабочий стол
$ErrorActionPreference = 'Stop'
$desktop = [Environment]::GetFolderPath('Desktop')
$ws = New-Object -ComObject WScript.Shell
$lnk = $ws.CreateShortcut((Join-Path $desktop 'Глосс Скряга — AgentPong.lnk'))
$lnk.TargetPath = 'D:\stepweather-prog\AgentPong\tools\run-agent-ui.bat'
$lnk.WorkingDirectory = 'D:\stepweather-prog\AgentPong'
$lnk.Description = 'Запуск диалога с агентом Глосс Скряга (локальный UI + Piper)'
$lnk.Save()
Write-Output ("OK: " + (Join-Path $desktop 'Глосс Скряга — AgentPong.lnk'))
