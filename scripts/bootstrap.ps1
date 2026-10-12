param([switch]$UseMirror)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$piRoot = Join-Path (Split-Path -Parent $projectRoot) 'pi-main'
$cacheRoot = Join-Path (Split-Path -Parent $projectRoot) '.npm-cache'
function Run-Checked([string]$Program, [string[]]$Arguments) {
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Program failed with exit code $LASTEXITCODE" }
}
if (-not (Test-Path -LiteralPath (Join-Path $piRoot 'packages/coding-agent/package.json'))) {
    throw 'Keep the downloaded pi-main folder next to PiCareer.'
}
Push-Location $piRoot
try {
    Run-Checked 'npm.cmd' @('ci', '--ignore-scripts', '--no-audit', '--no-fund', '--offline=false', "--cache=$cacheRoot")
    # The downloaded source expects schema 6; the matching 0.87.1 published catalogue uses schema 3.
    # Reuse only generated catalogue data from the compatible official 0.99.0 npm artifact.
    $catalogCache = Join-Path $projectRoot '.cache/bootstrap-catalog'
    New-Item -ItemType Directory -Path $catalogCache -Force | Out-Null
    Push-Location $catalogCache
    try {
        Run-Checked 'npm.cmd' @('pack', '@earendil-works/pi-ai@0.99.0', '--ignore-scripts', '--offline=false', "--cache=$cacheRoot")
        Run-Checked 'tar.exe' @('-xf', 'earendil-works-pi-ai-0.99.0.tgz')
        $modelTarget = Join-Path $piRoot 'packages/ai/src/providers/data'
        New-Item -ItemType Directory -Path $modelTarget -Force | Out-Null
        Get-ChildItem -LiteralPath (Join-Path $catalogCache 'package/dist/providers/data') -Force -File | Copy-Item -Destination $modelTarget -Force
    } finally { Pop-Location }
    Run-Checked 'node.exe' @('packages/ai/scripts/check-model-data.ts')
    Run-Checked 'npm.cmd' @('run', 'build:offline')
} finally { Pop-Location }
Push-Location $projectRoot
try {
    Run-Checked 'npm.cmd' @('ci', '--ignore-scripts', '--no-audit', '--no-fund')
    if ($UseMirror) { $env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/' }
    $env:ELECTRON_CACHE = Join-Path (Split-Path -Parent $projectRoot) '.electron-cache'
    # Explicitly allow only Electron's runtime download installer; all other dependency lifecycle scripts stay disabled.
    Run-Checked 'node.exe' @('node_modules/electron/install.js')
    Run-Checked 'npm.cmd' @('run', 'build')
    Run-Checked 'npm.cmd' @('run', 'check')
    Run-Checked 'npm.cmd' @('test')
} finally { Pop-Location }
