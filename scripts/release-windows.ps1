$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
$version = (Get-Content -Raw -LiteralPath (Join-Path $project 'package.json') | ConvertFrom-Json).version
if ($version -notmatch '^\d+\.\d+\.\d+(?:-[a-z0-9.]+)?$') { throw 'Invalid package version.' }
& node (Join-Path $PSScriptRoot 'check-source.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Release source validation failed.' }

$files = [string[]](Get-Content -LiteralPath (Join-Path $PSScriptRoot 'release-files.txt'))
[Array]::Sort($files, [StringComparer]::Ordinal)
$release = Join-Path $project 'dist'
New-Item -ItemType Directory -Path $release -Force | Out-Null
$name = "HaloFlux-for-Codex-v$version-windows.zip"
$zip = Join-Path $release $name
$stage = Join-Path $release ('.haloflux-' + [guid]::NewGuid().ToString('N') + '.tmp')
$stamp = [DateTimeOffset]::new(2000, 1, 1, 0, 0, 0, [TimeSpan]::Zero)
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
try {
    $archive = [IO.Compression.ZipFile]::Open($stage, [IO.Compression.ZipArchiveMode]::Create)
    try {
        foreach ($file in $files) {
            $entry = $archive.CreateEntry($file, [IO.Compression.CompressionLevel]::Optimal)
            $entry.LastWriteTime = $stamp
            $entry.ExternalAttributes = 0
            $source = [IO.File]::OpenRead((Join-Path $project $file))
            try {
                $destination = $entry.Open()
                try { $source.CopyTo($destination) } finally { $destination.Dispose() }
            } finally { $source.Dispose() }
        }
    } finally {
        $archive.Dispose()
    }
    $archive = [IO.Compression.ZipFile]::OpenRead($stage)
    try {
        if ($archive.Entries.Count -ne $files.Count) { throw 'Unexpected ZIP entry count.' }
        foreach ($file in $files) {
            $stream = $archive.GetEntry($file).Open()
            try {
                $entryHash = (Get-FileHash -InputStream $stream).Hash
                if ($entryHash -ne (Get-FileHash -LiteralPath (Join-Path $project $file)).Hash) {
                    throw "ZIP entry hash mismatch for $file"
                }
            } finally {
                $stream.Dispose()
            }
        }
    } finally {
        $archive.Dispose()
    }
    $hash = (Get-FileHash -LiteralPath $stage).Hash.ToLowerInvariant()
    Move-Item -LiteralPath $stage -Destination $zip -Force
    [IO.File]::WriteAllText("$zip.sha256", "$hash  $name`n", [Text.Encoding]::ASCII)
    Write-Output "$hash  $name"
} finally {
    if (Test-Path -LiteralPath $stage -PathType Leaf) { Remove-Item -LiteralPath $stage }
}
