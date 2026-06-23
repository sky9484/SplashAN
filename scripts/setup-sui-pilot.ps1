param(
    [string]$InstallPath = ".tools/sui-pilot"
)

$ErrorActionPreference = "Stop"
$repository = "https://github.com/contract-hero/sui-pilot.git"
$resolvedPath = Join-Path (Get-Location) $InstallPath

if (Test-Path (Join-Path $resolvedPath ".git")) {
    Write-Host "Updating Sui Pilot at $resolvedPath"
    git -C $resolvedPath pull --ff-only
} elseif (Test-Path $resolvedPath) {
    throw "$resolvedPath exists but is not a Sui Pilot git checkout."
} else {
    $parent = Split-Path $resolvedPath -Parent
    New-Item -ItemType Directory -Force -Path $parent | Out-Null
    Write-Host "Installing Sui Pilot at $resolvedPath"
    git clone --depth 1 $repository $resolvedPath
}

Write-Host "Sui Pilot is ready. See docs/sui-pilot.md for the Splash workflow."
