$ErrorActionPreference = 'Stop'
$gateway = 'https://llm.shre.ai'
$vault = 'http://127.0.0.1:5473'
$agentId = if ($env:SHRE_VAULT_STORE_AGENT) { $env:SHRE_VAULT_STORE_AGENT } else { 'shadow-ops' }

Write-Host 'AROS local model enrollment'
Write-Host 'The one-time token is entered securely and is not written to disk or command history.'
$secure = Read-Host 'Enrollment token' -AsSecureString
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try { $token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
if ([string]::IsNullOrWhiteSpace($token)) { throw 'Enrollment token is required.' }

try { Invoke-RestMethod -Uri "$vault/readyz" -Method Get -TimeoutSec 5 | Out-Null }
catch { throw "The local Shre secrets vault is not reachable at $vault. Start the local AUM/Shre runtime, then retry." }

$device = "$env:COMPUTERNAME-windows"
$issued = Invoke-RestMethod -Uri "$gateway/api/enroll" -Method Post -ContentType 'application/json' -Body (@{ token = $token; device_name = $device } | ConvertTo-Json) -TimeoutSec 30
$token = $null
$headers = @{ 'x-shre-agent-id' = $agentId }
$secretName = "aros-model-$($issued.key_alias)"
Invoke-RestMethod -Uri "$vault/v1/credential" -Method Post -Headers $headers -ContentType 'application/json' -Body (@{ name = $secretName; value = $issued.key } | ConvertTo-Json) -TimeoutSec 10 | Out-Null
$issued.key = $null
$config = @{ key_ref = $secretName; key_alias = $issued.key_alias; model = $issued.model; base_url = $issued.base_url } | ConvertTo-Json -Compress
Invoke-RestMethod -Uri "$vault/v1/credential" -Method Post -Headers $headers -ContentType 'application/json' -Body (@{ name = 'aros-model-active'; value = $config } | ConvertTo-Json) -TimeoutSec 10 | Out-Null
Write-Host "Enrollment complete. Credential '$secretName' is stored in the local encrypted vault."
Write-Host 'Supabase stores only the credential alias and SHA-256 fingerprint.'
