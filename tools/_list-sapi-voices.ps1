# _list-sapi-voices.ps1 — диагностика голосов SAPI (используется AgentPong)
Add-Type -AssemblyName System.Speech
try {
    $s = New-Object System.Speech.Synthesis.SpeechSynthesizer
    Write-Output ('PSVersion: ' + $PSVersionTable.PSVersion)
    $voices = $s.GetInstalledVoices()
    Write-Output ('VoiceCount: ' + @($voices).Count)
    foreach ($v in $voices) {
        Write-Output (' - ' + $v.VoiceInfo.Name + ' [' + $v.VoiceInfo.Culture.Name + '] gender=' + $v.VoiceInfo.Gender)
    }
} catch {
    Write-Output ('FAIL: ' + $_.Exception.Message)
}
