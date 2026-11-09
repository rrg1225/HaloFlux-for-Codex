$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Utility/Microsoft.PowerShell.Utility.psd1') -Scope Local
$project = Split-Path -Parent $PSScriptRoot
$temp = (Get-Item -LiteralPath ([IO.Path]::GetTempPath())).FullName
$scratch = Join-Path $temp ('haloflux-package-test-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $scratch | Out-Null
try {
    $launcher = [IO.File]::ReadAllText((Join-Path $project 'Start-HaloFlux.cmd'))
    foreach ($line in @('setlocal DisableDelayedExpansion', 'for %%I in (node.exe) do set "HALOFLUX_NODE=%%~$PATH:I"',
        '"%HALOFLUX_NODE%" "%~dp0scripts\start-windows.mjs"', 'exit /b %HALOFLUX_EXIT%')) {
        if (($launcher -split '\r?\n') -cnotcontains $line) { throw 'Unexpected launcher structure.' }
    }
    if ($launcher -match '(?i)runas|executionpolicy|https?://|\bsetx\b') { throw 'Unexpected launcher privilege or network change.' }
    $version = (Get-Content -Raw -LiteralPath (Join-Path $project 'package.json') | ConvertFrom-Json).version
    $name = "HaloFlux-for-Codex-v$version-windows.zip"
    $first = Join-Path $scratch 'first'
    $second = Join-Path $scratch 'second'
    & (Join-Path $PSScriptRoot 'release-windows.ps1') -OutputDirectory $first
    & (Join-Path $PSScriptRoot 'release-windows.ps1') -OutputDirectory $second
    $zip = Join-Path $first $name
    $hash = (Get-FileHash -LiteralPath $zip).Hash.ToLowerInvariant()
    if ((Get-FileHash -LiteralPath (Join-Path $second $name)).Hash -ne $hash) { throw 'ZIP is not reproducible.' }
    foreach ($folder in @($first, $second)) {
        if ([IO.File]::ReadAllText((Join-Path $folder "$name.sha256")) -cne "$hash  $name`n") { throw 'SHA-256 sidecar mismatch.' }
    }
    # Keep this script ASCII for Windows PowerShell 5.1 while exercising Unicode paths.
    $target = Join-Path $scratch ('HaloFlux ' + [char]0x5B89 + [char]0x88C5 + ' test')
    [IO.Compression.ZipFile]::ExtractToDirectory($zip, $target)
    Push-Location -LiteralPath $target
    try {
        & node --test 'test/*.test.mjs'
        if ($LASTEXITCODE -ne 0) { throw 'Extracted package tests failed.' }
        & node scripts/test-windows-launcher.mjs
        if ($LASTEXITCODE -ne 0) { throw 'Extracted launcher test failed.' }
    } finally { Pop-Location }
    Write-Output 'Windows launcher, two archives, SHA-256 sidecars, contents and extracted offline tests verified.'
} finally {
    $resolved = (Get-Item -LiteralPath $scratch).FullName
    if ((Split-Path -Parent $resolved) -eq $temp -and (Split-Path -Leaf $resolved) -like 'haloflux-package-test-*') {
        Remove-Item -LiteralPath $resolved -Recurse -Force
    }
}
