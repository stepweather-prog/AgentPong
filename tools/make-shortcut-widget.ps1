# AgentPong: ярлык виджета на рабочий стол
$ErrorActionPreference = 'Stop'
$desktop = [Environment]::GetFolderPath('Desktop')
$ws = New-Object -ComObject WScript.Shell
$lnk = $ws.CreateShortcut((Join-Path $desktop 'Глосс Скряга (виджет).lnk'))
$lnk.TargetPath = 'D:\stepweather-prog\AgentPong\tools\run-agent-widget.bat'
$lnk.WorkingDirectory = 'D:\stepweather-prog\AgentPong'
$lnk.Description = 'Глосс Скряга: виджет-агент на экране, трей, ворчание'
$lnk.IconLocation = 'D:\stepweather-prog\AgentPong\Asset\agent\icon.png'
$lnk.Save()
Write-Output ("OK: " + (Join-Path $desktop 'Глосс Скряга (виджет).lnk'))
