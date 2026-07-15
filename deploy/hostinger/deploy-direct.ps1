param(
    [string]$SshTarget = 'root@aros-vps',
    [string]$Ref = 'HEAD'
)

$ErrorActionPreference = 'Stop'
$repo = (git rev-parse --show-toplevel).Trim()
if (-not $repo) { throw 'Run this command from the AROS git repository.' }
Set-Location $repo

$dirty = git status --porcelain
if ($dirty) {
    throw 'The working tree must be clean. Commit the exact release snapshot first.'
}

git rev-parse --verify "$Ref^{commit}" *> $null
if ($LASTEXITCODE -ne 0) { throw "Unknown git ref: $Ref" }

$stamp = Get-Date -Format 'yyyyMMddHHmmss'
$bundle = Join-Path $env:TEMP "aros-direct-$stamp.bundle"
$remoteBundle = "/tmp/aros-direct-$stamp.bundle"
$remoteScript = "/tmp/aros-deploy-bundle-$stamp.sh"

try {
    git bundle create $bundle $Ref
    if ($LASTEXITCODE -ne 0) { throw 'Unable to create release bundle.' }

    scp $bundle "${SshTarget}:$remoteBundle"
    scp (Join-Path $repo 'deploy/hostinger/deploy-bundle.sh') "${SshTarget}:$remoteScript"
    if ($LASTEXITCODE -ne 0) { throw 'Unable to upload the release bundle.' }

    ssh $SshTarget "chmod 700 '$remoteScript' && bash '$remoteScript' '$remoteBundle' HEAD"
    if ($LASTEXITCODE -ne 0) { throw 'Remote deployment failed or rolled back.' }

    $response = Invoke-WebRequest -Uri 'https://aros.live' -Method Head `
        -MaximumRedirection 5 -TimeoutSec 30 -UseBasicParsing
    if ($response.StatusCode -ne 200) {
        throw "Public health check returned HTTP $($response.StatusCode)."
    }
    Write-Host "AROS direct deployment passed: $Ref -> https://aros.live"
}
finally {
    Remove-Item -LiteralPath $bundle -Force -ErrorAction SilentlyContinue
    ssh $SshTarget "rm -f '$remoteBundle' '$remoteScript'" 2>$null | Out-Null
}
