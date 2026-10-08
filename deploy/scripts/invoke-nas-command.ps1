[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Command,
    [string]$SshHost = 'zfyynas',
    [string]$SecretsFile = '',
    [ValidateRange(1, 3600)][int]$TimeoutSeconds = 120
)

$ErrorActionPreference = 'Stop'
if ($SshHost -notmatch '^[A-Za-z0-9][A-Za-z0-9_.@:-]*$') { throw 'Invalid SSH host.' }
if (-not $SecretsFile) {
    $SecretsFile = Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'secrets.local.env'
}
$password = $null
foreach ($line in Get-Content -LiteralPath $SecretsFile -Encoding utf8) {
    if ($line -match '^\s*NAS_SUDO_PASSWORD\s*=(.*)$') { $password = $matches[1] }
}
if ([string]::IsNullOrEmpty($password)) { throw '请在 secrets.local.env 中填写 NAS_SUDO_PASSWORD；不要在聊天中发送密码。' }
if ($password.Contains("`r") -or $password.Contains("`n")) { throw 'NAS_SUDO_PASSWORD must be a single line.' }

# Password never appears in SSH arguments, shell interpolation, or output.
# The existing SSH key authenticates the connection; sudo receives one line
# through its encrypted stdin. No sudoers changes or broad NOPASSWD grants.
$quotedCommand = "'" + $Command.Replace("'", "'\''") + "'"
$startInfo = [System.Diagnostics.ProcessStartInfo]::new()
$startInfo.FileName = 'ssh'
$startInfo.UseShellExecute = $false
$startInfo.RedirectStandardInput = $true
$startInfo.RedirectStandardOutput = $true
$startInfo.RedirectStandardError = $true
$startInfo.StandardInputEncoding = [System.Text.UTF8Encoding]::new($false)
$startInfo.StandardOutputEncoding = [System.Text.Encoding]::UTF8
$startInfo.StandardErrorEncoding = [System.Text.Encoding]::UTF8
foreach ($argument in @('-T', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=2', $SshHost, "sudo -S -p '' -- sh -c $quotedCommand")) {
    $startInfo.ArgumentList.Add($argument)
}
$process = [System.Diagnostics.Process]::new()
$process.StartInfo = $startInfo
try {
    if (-not $process.Start()) { throw 'Could not start SSH.' }
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()
    $process.StandardInput.WriteLine($password)
    $process.StandardInput.Close()
    if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
        $process.Kill($true)
        $process.WaitForExit()
        throw 'NAS 命令等待超时；SSH 已关闭，远端进程可能仍在执行，请先检查状态，勿盲目重试。'
    }
    $stdout = $stdoutTask.GetAwaiter().GetResult().Replace($password, '[REDACTED]')
    $stderr = $stderrTask.GetAwaiter().GetResult().Replace($password, '[REDACTED]')
    if ($stdout) { Write-Output $stdout.TrimEnd() }
    if ($stderr) { Write-Host $stderr.TrimEnd() }
    if ($process.ExitCode -ne 0) { throw "NAS 命令失败（退出码 $($process.ExitCode)）；若 sudo 认证失败，请检查本地 NAS_SUDO_PASSWORD。" }
} finally {
    $password = $null
    $process.Dispose()
}
