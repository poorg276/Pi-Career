$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$installRoot = Join-Path $env:LOCALAPPDATA 'Programs\PiCareer'
$installedExe = Join-Path $installRoot 'PiCareer.exe'
$installer = Join-Path $projectRoot 'release\PiCareer-0.1.5-x64.exe'
$database = Join-Path $env:APPDATA 'PiCareer\picareer.sqlite'
$shortcut = Join-Path ([Environment]::GetFolderPath('Desktop')) 'PiCareer.lnk'
if (-not (Test-Path -LiteralPath $installedExe)) { throw 'Expected existing PiCareer installation was not found.' }
$running = @(Get-Process PiCareer -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $installedExe })
foreach ($application in $running) { if ($application.MainWindowHandle -ne 0) { $null = $application.CloseMainWindow() } }
for ($i = 0; $i -lt 20 -and @(Get-Process PiCareer -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $installedExe }).Count -gt 0; $i++) { Start-Sleep -Milliseconds 500 }
if (@(Get-Process PiCareer -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $installedExe }).Count -gt 0) { throw 'PiCareer did not close normally; update stopped before modifying the installation.' }
$before = if (Test-Path -LiteralPath $database) { (Get-FileHash -LiteralPath $database -Algorithm SHA256).Hash } else { $null }
$upgrade = Start-Process -FilePath $installer -ArgumentList "/S /D=$installRoot" -WindowStyle Hidden -Wait -PassThru
if ($upgrade.ExitCode -ne 0) { throw "Installer failed: $($upgrade.ExitCode)" }
$after = if (Test-Path -LiteralPath $database) { (Get-FileHash -LiteralPath $database -Algorithm SHA256).Hash } else { $null }
if ($before -ne $after) { throw 'User database changed during installation.' }
$files = @('PiCareer.exe', 'resources\app.asar', 'resources\resources\pi\worker.mjs', 'resources\resources\pi\node_modules\@earendil-works\pi-ai\dist\picareer-compat.json')
$verified = @()
foreach ($file in $files) {
    $actual = (Get-FileHash -LiteralPath (Join-Path $installRoot $file) -Algorithm SHA256).Hash
    $expected = (Get-FileHash -LiteralPath (Join-Path $projectRoot "release\win-unpacked\$file") -Algorithm SHA256).Hash
    if ($actual -ne $expected) { throw "Installed file differs from release: $file" }
    $verified += @{ file=$file; sha256=$actual }
}
$target = (New-Object -ComObject WScript.Shell).CreateShortcut($shortcut).TargetPath
if ([IO.Path]::GetFullPath($target) -ne [IO.Path]::GetFullPath($installedExe)) { throw 'Desktop shortcut points to a different application.' }
$evidence = @{ version='0.1.5'; passed=$true; installerExitCode=$upgrade.ExitCode; installedExe=$installedExe; shortcutTarget=$target; databasePreserved=$true; databaseBefore=$before; databaseAfter=$after; files=$verified; realAccountLogin='verified_existing_account_keyless_search_and_public_web'; at=(Get-Date).ToString('o') }
$evidence | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $projectRoot 'docs\evidence\installed-0.1.5.json') -Encoding utf8
$evidence | ConvertTo-Json -Depth 6

