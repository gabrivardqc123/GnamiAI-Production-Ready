Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Write-Host "[1/5] Installing dependencies..."
npm install

Write-Host "[2/5] Building project..."
npm run build

Write-Host "[3/5] Linking CLI..."
npm link

Write-Host "[4/5] Running onboarding..."
gnamiai onboard

Write-Host "[5/5] Starting gateway..."
gnamiai gateway --verbose