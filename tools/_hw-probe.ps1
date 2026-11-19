# _hw-probe.ps1 — разведка железа под локальный мозг (AgentPong)
$ErrorActionPreference = 'Continue'
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
Write-Output ('CPU: ' + $cpu.Name.Trim())
Write-Output ('Cores: ' + $cpu.NumberOfCores + ' threads: ' + $cpu.NumberOfLogicalProcessors)

$cs = Get-CimInstance Win32_ComputerSystem
Write-Output ('RAM total: ' + [math]::Round($cs.TotalPhysicalMemory / 1GB, 2) + ' GB')

$os = Get-CimInstance Win32_OperatingSystem
Write-Output ('RAM free: ' + [math]::Round($os.FreePhysicalMemory * 1KB / 1GB, 2) + ' GB')

$simm = Get-CimInstance Win32_PhysicalMemory
foreach ($m in $simm) {
    Write-Output (' - dimm: ' + [math]::Round($m.Capacity / 1GB, 0) + ' GB, ' + $m.Speed + ' MHz, type=' + $m.SMBIOSMemoryType)
}

Get-CimInstance Win32_VideoController | ForEach-Object {
    Write-Output ('GPU: ' + $_.Name.Trim() + ', VRAM: ' + [math]::Round($_.AdapterRAM / 1GB, 2) + ' GB, driver: ' + $_.DriverVersion)
}

Write-Output '--- swap/virtual ---'
Write-Output ('Swap total: ' + [math]::Round(($os.TotalVirtualMemorySize * 1KB) / 1GB, 2) + ' GB, free: ' + [math]::Round(($os.FreeVirtualMemory * 1KB) / 1GB, 2) + ' GB')
