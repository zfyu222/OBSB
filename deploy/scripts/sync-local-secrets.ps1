[CmdletBinding()]
param(
    [string]$SecretsFile = '',
    [string]$SshHost = 'zfyynas'
)

if (-not $SecretsFile) {
    $SecretsFile = Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'secrets.local.env'
}
$resolved = (Resolve-Path -LiteralPath $SecretsFile -ErrorAction Stop).Path
$values = @{}
foreach ($line in Get-Content -LiteralPath $resolved -Encoding utf8) {
    if ($line -match '^\s*(#|$)') { continue }
    $parts = $line -split '=', 2
    if ($parts.Count -ne 2) { throw "Invalid secret line in ${resolved}: $line" }
    $values[$parts[0].Trim()] = $parts[1]
}

function Write-NasSecret([string]$Path, [string[]]$Names) {
    $lines = foreach ($name in $Names) {
        if ($values.ContainsKey($name) -and $values[$name]) { "$name=$($values[$name])" }
    }
    if (-not $lines) { return }
    $payload = [string]::Join("`n", $lines) + "`n"
    $payload | ssh $SshHost "umask 077; tr -d '\r' | dd of='$Path' bs=1 status=none; chmod 600 '$Path'; chown 1026:100 '$Path'"
    if ($LASTEXITCODE -ne 0) { throw "Failed to write $Path on $SshHost" }
}

function Write-NasPrivateText([string]$Path, [string]$Text) {
    $Text | ssh $SshHost "umask 077; tr -d '\r' | dd of='$Path' bs=1 status=none; chmod 600 '$Path'; chown 1026:100 '$Path'"
    if ($LASTEXITCODE -ne 0) { throw "Failed to write $Path on $SshHost" }
}

Write-NasSecret '/volume2/OBSB/secrets/deepseek.env' @('DEEPSEEK_API_KEY')
if ($values['OPENCODE_SERVER_USERNAME'] -or $values['OPENCODE_SERVER_PASSWORD']) {
    if (-not ($values['OPENCODE_SERVER_USERNAME'] -and $values['OPENCODE_SERVER_PASSWORD'])) {
        throw 'Set both OPENCODE_SERVER_USERNAME and OPENCODE_SERVER_PASSWORD, or leave both blank.'
    }
    Write-NasSecret '/volume2/OBSB/secrets/opencode.env' @('OPENCODE_SERVER_USERNAME', 'OPENCODE_SERVER_PASSWORD')
}

if ($values['TENCENT_GIT_TOKEN']) {
    # GitCode/Tencent Git accepts a personal access token as the HTTPS password.
    # The account name defaults to this repository owner's GitCode account and can
    # be overridden locally without ever entering a tracked configuration file.
    $gitUsername = if ($values['TENCENT_GIT_USERNAME']) { $values['TENCENT_GIT_USERNAME'] } else { 'eddiezeng' }
    $escapedUsername = [uri]::EscapeDataString($gitUsername)
    # This runtime-only credential store is mounted as brain-agent's HOME and is
    # outside both the framework and knowledge repositories.
    $escapedToken = [uri]::EscapeDataString($values['TENCENT_GIT_TOKEN'])
    Write-NasPrivateText '/volume2/OBSB/runtime/opencode/.git-credentials' "https://${escapedUsername}:$escapedToken@git.code.tencent.com`n"
}

Write-Host 'Uploaded supplied secrets to NAS without displaying their values.'
