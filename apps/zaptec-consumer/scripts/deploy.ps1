# One-shot deploy of the Zaptec consumer to Fly.io.
#
# Walks through:
#   1. flyctl install / auth check
#   2. flyctl launch (idempotent - skips if app already exists)
#   3. Prompts for ZAPTEC_USERNAME, ZAPTEC_PASSWORD, OCPP_INGEST_SECRET
#      via Read-Host -AsSecureString (values masked, never echoed)
#   4. flyctl secrets import via stdin (avoids ps-listing the values)
#   5. flyctl deploy
#   6. Tails logs for ~30 seconds so you can see AMQP connection
#      attempts in real time
#
# Run from this directory:
#   .\scripts\deploy.ps1
#
# ASCII-only by design - PowerShell 5.1 reads non-BOM scripts as
# Windows-1252 and mangles UTF-8 multi-byte sequences (caught when
# the original em-dash / box-drawing chars failed to parse,
# 2026-05-06).

$ErrorActionPreference = "Stop"
$AppName = "straumvakt-zaptec-consumer-staging"

# Step 1: flyctl present? Check PATH first; fall back to the default
# install location ($env:USERPROFILE\.fly\bin) since the install script
# appends to user PATH but doesn't propagate to existing shells.
$fly = Get-Command flyctl -ErrorAction SilentlyContinue
if (-not $fly) { $fly = Get-Command fly -ErrorAction SilentlyContinue }
if (-not $fly) {
  $defaultInstall = Join-Path $env:USERPROFILE ".fly\bin\flyctl.exe"
  if (Test-Path $defaultInstall) {
    # Add the install dir to session PATH, then re-resolve via
    # Get-Command so we get a proper CommandInfo (with .Source) -
    # Get-Item returns a FileInfo which doesn't have that property
    # and breaks the '& $flyExe' invocation later.
    $env:Path += ";$env:USERPROFILE\.fly\bin"
    $fly = Get-Command flyctl -ErrorAction SilentlyContinue
  }
}
if (-not $fly) {
  Write-Error @"
flyctl not on PATH and not at $env:USERPROFILE\.fly\bin\flyctl.exe.
Install on Windows:
  iwr https://fly.io/install.ps1 -useb | iex
Restart your shell after, then re-run this script.
"@
  exit 1
}
$flyExe = $fly.Source
Write-Host "Using flyctl: $flyExe" -ForegroundColor DarkGray

# Step 2: auth check
& $flyExe auth whoami 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
  Write-Host "Not logged in. Running flyctl auth login..." -ForegroundColor Yellow
  & $flyExe auth login
  if ($LASTEXITCODE -ne 0) {
    Write-Error "Login failed. Aborting."
    exit 1
  }
}
$me = (& $flyExe auth whoami).Trim()
Write-Host "Authed as: $me" -ForegroundColor Green

# Step 3: app exists? launch if not
Push-Location (Split-Path -Parent $PSScriptRoot)
try {
  & $flyExe status --app $AppName 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) {
    Write-Host "App '$AppName' doesn't exist - running flyctl launch..." -ForegroundColor Yellow
    & $flyExe launch `
      --no-deploy `
      --copy-config `
      --name $AppName `
      --region ams `
      --yes
    if ($LASTEXITCODE -ne 0) {
      Write-Error "flyctl launch failed."
      exit 1
    }
  }
  else {
    Write-Host "App '$AppName' exists. Will redeploy." -ForegroundColor Green
  }

  # Step 4: prompt secrets, import via stdin
  function Read-Plain($name) {
    $sec = Read-Host -Prompt "Enter $name (input hidden)" -AsSecureString
    $bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
    try {
      return [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
    }
    finally {
      [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    }
  }

  Write-Host "`nProvisioning secrets - values stay in this shell only." -ForegroundColor Cyan
  $zaptecUser = Read-Plain "ZAPTEC_USERNAME"
  $zaptecPass = Read-Plain "ZAPTEC_PASSWORD"
  $ingestSec  = Read-Plain "OCPP_INGEST_SECRET (same as the API Worker's)"

  $blob = "ZAPTEC_USERNAME=$zaptecUser`nZAPTEC_PASSWORD=$zaptecPass`nOCPP_INGEST_SECRET=$ingestSec"
  $blob | & $flyExe secrets import --app $AppName --stage
  if ($LASTEXITCODE -ne 0) {
    Write-Error "Secrets import failed."
    exit 1
  }
  # Wipe the locals (best-effort - PowerShell GC will get them anyway).
  Remove-Variable zaptecUser, zaptecPass, ingestSec, blob -ErrorAction SilentlyContinue

  # Step 5: deploy
  Write-Host "`nDeploying..." -ForegroundColor Cyan
  & $flyExe deploy --app $AppName --remote-only
  if ($LASTEXITCODE -ne 0) {
    Write-Error "Deploy failed. Check 'flyctl logs --app $AppName' for the cause."
    exit 1
  }

  # Step 6: tail for ~30s
  Write-Host "`nDeployed. Tailing logs for 30s - Ctrl+C to stop earlier:`n" -ForegroundColor Green
  $job = Start-Job -ScriptBlock {
    param($exe, $app)
    & $exe logs --app $app
  } -ArgumentList $flyExe, $AppName

  Start-Sleep -Seconds 30
  Stop-Job $job
  Receive-Job $job
  Remove-Job $job

  Write-Host "`nDone. To keep watching: flyctl logs --app $AppName" -ForegroundColor Green
}
finally {
  Pop-Location
}
