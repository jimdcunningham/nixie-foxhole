param(
    [Parameter(Mandatory = $true)]
    [string]$ArchivePath,

    [Parameter(Mandatory = $true)]
    [string]$DestinationPath
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $ArchivePath -PathType Leaf)) {
    throw "Archive does not exist: $ArchivePath"
}

New-Item -ItemType Directory -Path $DestinationPath -Force | Out-Null
Expand-Archive -LiteralPath $ArchivePath -DestinationPath $DestinationPath -Force
