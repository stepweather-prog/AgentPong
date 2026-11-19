# AgentPong: desktop shortcut for local tests
$ErrorActionPreference = 'Stop'
$desktop = [Environment]::GetFolderPath('Desktop')
$ws = New-Object -ComObject WScript.Shell
$lnk = $ws.CreateShortcut((Join-Path $desktop 'AgentPong Локальные Тесты.lnk'))
$lnk.TargetPath = 'D:\stepweather-prog\AgentPong\tools\run-local-tests.bat'
$lnk.WorkingDirectory = 'D:\stepweather-prog\AgentPong'
$lnk.Description = 'Прогон локальных тестов протокола HTTPR (AgentPong)'
$lnk.Save()
Write-Output ("OK: " + (Join-Path $desktop 'AgentPong Локальные Тесты.lnk'))
