param(
    [Parameter(Mandatory=$true)][string]$ElectronArchive,
    [string]$OutputDirectory
)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Utility/Microsoft.PowerShell.Utility.psd1') -Scope Local
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
$project = Split-Path -Parent $PSScriptRoot
$runtime = Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot 'desktop-runtime.json') | ConvertFrom-Json
$package = Get-Content -Raw -LiteralPath (Join-Path $project 'package.json') | ConvertFrom-Json
if ($package.version -notmatch '^\d+\.\d+\.\d+-(alpha|beta)\.\d+$') { throw 'Expected desktop prerelease version.' }
$inputZip = (Get-Item -LiteralPath $ElectronArchive).FullName
if ((Get-FileHash -LiteralPath $inputZip -Algorithm SHA256).Hash -ne $runtime.sha256) {
    throw "Expected the verified Electron archive $($runtime.archive)."
}
& node (Join-Path $PSScriptRoot 'check-source.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Release source validation failed.' }

$name = "HaloFlux-for-Codex-v$($package.version)-windows-x64-desktop.zip"
$release = if ($OutputDirectory) { [IO.Path]::GetFullPath($OutputDirectory) } else { Join-Path $project 'dist' }
New-Item -ItemType Directory -Path $release -Force | Out-Null
$zip = Join-Path $release $name
$zipStage = Join-Path $release ('.haloflux-desktop-' + [guid]::NewGuid().ToString('N') + '.tmp')
$temp = (Get-Item -LiteralPath ([IO.Path]::GetTempPath())).FullName
$stage = Join-Path $temp ('haloflux-desktop-build-' + [guid]::NewGuid().ToString('N'))
$stamp = [DateTimeOffset]::new(2000, 1, 1, 0, 0, 0, [TimeSpan]::Zero)
New-Item -ItemType Directory -Path $stage | Out-Null
try {
    [IO.Compression.ZipFile]::ExtractToDirectory($inputZip, $stage)
    if ((Get-Content -Raw -LiteralPath (Join-Path $stage 'version')).Trim() -ne $runtime.version) {
        throw 'Runtime version mismatch.'
    }
    foreach ($required in @('electron.exe', 'LICENSE', 'LICENSES.chromium.html', 'resources/default_app.asar')) {
        if (!(Test-Path -LiteralPath (Join-Path $stage $required) -PathType Leaf)) { throw "Missing runtime file $required" }
    }
    $executable = Join-Path $stage 'electron.exe'
    & node (Join-Path $PSScriptRoot 'harden-electron.mjs') $executable
    if ($LASTEXITCODE -ne 0) { throw 'Electron fuse verification failed.' }
    Rename-Item -LiteralPath $executable -NewName 'HaloFlux.exe'
    Remove-Item -LiteralPath (Join-Path $stage 'resources/default_app.asar')
    $appRoot = Join-Path $stage 'resources/app'
    foreach ($file in (Get-Content -LiteralPath (Join-Path $PSScriptRoot 'desktop-files.txt'))) {
        $destination = Join-Path $appRoot $file
        New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
        Copy-Item -LiteralPath (Join-Path $project $file) -Destination $destination
    }
    $guide = [IO.File]::ReadAllText((Join-Path $appRoot 'docs/DESKTOP-WINDOWS.md'))
    [IO.File]::WriteAllText((Join-Path $stage 'START-HERE.md'),
        $guide.Replace('(DESKTOP-PERFORMANCE.md)', '(resources/app/docs/DESKTOP-PERFORMANCE.md)'))
    Copy-Item -LiteralPath (Join-Path $appRoot 'LICENSE') -Destination (Join-Path $stage 'LICENSE-HALOFLUX.txt')
    $notice = [IO.File]::ReadAllText((Join-Path $appRoot 'NOTICE.md'))
    [IO.File]::WriteAllText((Join-Path $stage 'NOTICE.md'), $notice.Replace('(LICENSE)', '(LICENSE-HALOFLUX.txt)'))
    $prefix = $stage.Length + 1
    $files = [string[]]@(Get-ChildItem -LiteralPath $stage -File -Recurse | ForEach-Object {
        $_.FullName.Substring($prefix).Replace('\', '/')
    })
    [Array]::Sort($files, [StringComparer]::Ordinal)
    $hashes = @{}
    $archive = [IO.Compression.ZipFile]::Open($zipStage, [IO.Compression.ZipArchiveMode]::Create)
    try {
        foreach ($file in $files) {
            $source = Join-Path $stage $file
            $hashes[$file] = (Get-FileHash -LiteralPath $source).Hash
            $entry = $archive.CreateEntry($file, [IO.Compression.CompressionLevel]::Optimal)
            $entry.LastWriteTime = $stamp
            $entry.ExternalAttributes = 0
            $stream = $entry.Open()
            $content = [IO.File]::OpenRead($source)
            try { $content.CopyTo($stream) } finally { $content.Dispose(); $stream.Dispose() }
        }
    } finally { $archive.Dispose() }
    $archive = [IO.Compression.ZipFile]::OpenRead($zipStage)
    try {
        if ($archive.Entries.Count -ne $files.Count) { throw 'Unexpected desktop ZIP entry count.' }
        foreach ($file in $files) {
            $stream = $archive.GetEntry($file).Open()
            try {
                if ((Get-FileHash -InputStream $stream).Hash -ne $hashes[$file]) { throw "ZIP mismatch for $file" }
            } finally { $stream.Dispose() }
        }
    } finally { $archive.Dispose() }
    $hash = (Get-FileHash -LiteralPath $zipStage).Hash.ToLowerInvariant()
    $checksum = "$hash  $name`n"
    if ((Test-Path -LiteralPath $zip) -and (Get-FileHash -LiteralPath $zip).Hash -ne $hash) {
        throw 'Different ZIP already exists. Use another output directory.'
    }
    if ((Test-Path -LiteralPath "$zip.sha256") -and [IO.File]::ReadAllText("$zip.sha256") -cne $checksum) {
        throw 'Different SHA-256 file already exists. Use another output directory.'
    }
    if (!(Test-Path -LiteralPath $zip)) { Move-Item -LiteralPath $zipStage -Destination $zip }
    if (!(Test-Path -LiteralPath "$zip.sha256")) { [IO.File]::WriteAllText("$zip.sha256", $checksum, [Text.Encoding]::ASCII) }
    Write-Output "$($files.Count) entries verified"
    Write-Output "$hash  $name"
} finally {
    if (Test-Path -LiteralPath $zipStage -PathType Leaf) { Remove-Item -LiteralPath $zipStage }
    $resolved = (Get-Item -LiteralPath $stage).FullName
    if ((Split-Path -Parent $resolved) -eq $temp -and (Split-Path -Leaf $resolved) -like 'haloflux-desktop-build-*') {
        Remove-Item -LiteralPath $resolved -Recurse -Force
    }
}
