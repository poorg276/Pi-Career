$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$releaseVersion = (Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json).version
$installer = Join-Path $projectRoot "release/PiCareer-$releaseVersion-x64.exe"
$installRoot = Join-Path $env:LOCALAPPDATA 'Programs\PiCareer'
$appDataRoot = Join-Path $env:APPDATA 'PiCareer'
$shortcut = Join-Path ([Environment]::GetFolderPath('Desktop')) 'PiCareer.lnk'
if (Test-Path -LiteralPath (Join-Path $installRoot 'PiCareer.exe')) { throw 'Existing installation detected; do not replace it with an automated install/uninstall test.' }
function Install-PiCareer {
    $process = Start-Process -FilePath $installer -ArgumentList "/S /D=$installRoot" -WindowStyle Hidden -Wait -PassThru
    if ($process.ExitCode -ne 0) { throw "Installer failed: $($process.ExitCode)" }
    if (-not (Test-Path -LiteralPath (Join-Path $installRoot 'PiCareer.exe'))) { throw 'Missing installed executable' }
}
Install-PiCareer
if (-not (Test-Path -LiteralPath $shortcut)) { throw 'Missing desktop shortcut' }
$wsh = New-Object -ComObject WScript.Shell
$target = $wsh.CreateShortcut($shortcut).TargetPath
if ([IO.Path]::GetFullPath($target) -ne [IO.Path]::GetFullPath((Join-Path $installRoot 'PiCareer.exe'))) { throw 'Shortcut target mismatch' }
New-Item -ItemType Directory -Path $appDataRoot -Force | Out-Null
$marker = Join-Path $appDataRoot ('installation-test-' + [guid]::NewGuid().ToString() + '.txt')
Set-Content -LiteralPath $marker -Value 'Preserve application data across reinstall and uninstall.'
Install-PiCareer
if (-not (Test-Path -LiteralPath $marker)) { throw 'Reinstallation removed user data' }
$uninstaller = Join-Path $installRoot 'Uninstall PiCareer.exe'
$process = Start-Process -FilePath $uninstaller -ArgumentList '/S' -WindowStyle Hidden -Wait -PassThru
if ($process.ExitCode -ne 0) { throw "Uninstaller failed: $($process.ExitCode)" }
for ($attempt=0; $attempt -lt 20 -and (Test-Path -LiteralPath (Join-Path $installRoot 'PiCareer.exe')); $attempt++) { Start-Sleep -Milliseconds 500 }
if (Test-Path -LiteralPath (Join-Path $installRoot 'PiCareer.exe')) { throw 'Uninstaller left the executable installed' }
if (-not (Test-Path -LiteralPath $marker)) { throw 'Uninstall removed application data' }
Install-PiCareer
Remove-Item -LiteralPath $marker
$report = @{ passed=$true; installedPath=$installRoot; desktopShortcut=$shortcut; sameVersionReinstall=$true; uninstall=$true; dataPreserved=$true; finalInstallation=$true }
$report | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $projectRoot '.test-data/install-result.json')
$report | ConvertTo-Json
