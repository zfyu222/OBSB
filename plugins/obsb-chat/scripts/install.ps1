[CmdletBinding()]
param([Parameter(Mandatory = $true)][string]$VaultPath)

$ErrorActionPreference = 'Stop'
$vaultRoot = (Resolve-Path -LiteralPath $VaultPath).Path
if (-not (Test-Path -LiteralPath (Join-Path $vaultRoot '.obsidian') -PathType Container)) {
    throw '目标必须是已经初始化的 Obsidian 仓库（含 .obsidian）。'
}
$source = Join-Path (Split-Path -Parent $PSScriptRoot) 'dist/obsb-chat'
if (-not (Test-Path -LiteralPath (Join-Path $source 'main.js'))) { throw '请先运行 npm ci 和 npm run build。' }
$destination = Join-Path $vaultRoot '.obsidian/plugins/obsb-chat'
$files = @('main.js', 'manifest.json', 'styles.css')
if (Test-Path -LiteralPath $destination) {
    $backupRoot = Join-Path (Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))) 'artifacts'
    $backupPath = Join-Path $backupRoot ('obsb-chat-backup-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
    New-Item -ItemType Directory -Path $backupPath -Force | Out-Null
    foreach ($file in $files) {
        $previous = Join-Path $destination $file
        if (Test-Path -LiteralPath $previous) { Copy-Item -LiteralPath $previous -Destination (Join-Path $backupPath $file) }
    }
    Write-Host "旧插件程序已备份到 $backupPath"
}
New-Item -ItemType Directory -Path $destination -Force | Out-Null
foreach ($file in $files) { Copy-Item -LiteralPath (Join-Path $source $file) -Destination (Join-Path $destination $file) -Force }
Write-Host "已安装到 $destination；请在 Obsidian 社区插件中启用 OBSB AI 管家。原有 data.json 和其他插件配置保持不变。"
