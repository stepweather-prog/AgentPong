# AgentPong: один ярлык запуска агента на рабочий стол (виджет-режим)
$ErrorActionPreference = 'Stop'
$desktop = [Environment]::GetFolderPath('Desktop')
$ws = New-Object -ComObject WScript.Shell
$lnk = $ws.CreateShortcut((Join-Path $desktop 'Агент Понг.lnk'))
$lnk.TargetPath = 'D:\stepweather-prog\AgentPong\tools\run-agent-widget.bat'
$lnk.WorkingDirectory = 'D:\stepweather-prog\AgentPong'
$lnk.Description = 'Агент Понг: живой виджет на экране, трей, эмоции'
$lnk.IconLocation = 'D:\stepweather-prog\AgentPong\Asset\agent\icon.ico'
$lnk.Save()
Write-Output ("OK: " + (Join-Path $desktop 'Агент Понг.lnk'))
