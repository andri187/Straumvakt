<#
  Straumvakt E:\Claude cleanup DRY RUN — reports only.

  SAFETY, by construction rather than by discipline:
    * This script contains NO delete verb. There is no Remove-Item, no rmdir,
      no del, no rd, no Clear-*, no Move-Item, no git worktree remove, and no
      git branch -d anywhere in it. Grep it and check.
    * It reads the filesystem and git metadata and writes a manifest to stdout
      (and optionally to a file OUTSIDE E:\Claude).
    * It never contacts a network and never touches a control plane.

  It answers three questions:
    1. How much space would a prune reclaim, measured correctly?
    2. Is every preservation target still present and intact?
    3. In what order must junctions be unlinked so nothing is orphaned?

  Usage:
    pwsh -File cleanup-dryrun.ps1
    pwsh -File cleanup-dryrun.ps1 -OutFile "C:\Users\Andri\Documents\cleanup-manifest.txt"

  NOTE ON MEASUREMENT: sizes deliberately EXCLUDE reparse points. Following
  junctions double-counts shared node_modules and produced impossible figures
  (negative real content) on the first attempt at this measurement.
#>

[CmdletBinding()]
param(
  [string]$Root = 'E:\Claude',
  [string]$OutFile
)

$ErrorActionPreference = 'Stop'
$lines = New-Object System.Collections.Generic.List[string]
function Emit([string]$s) { $lines.Add($s); Write-Host $s }

Emit "Straumvakt cleanup DRY RUN — reports only, deletes nothing"
Emit ("Generated (UTC): " + (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ'))
Emit ("Root: $Root")
Emit ""

# ── 1. Preservation targets ─────────────────────────────────────────
Emit "== 1. PRESERVATION TARGETS (must exist; never delete) =="
$preserve = @(
  @{ Id='P1'; Path="$Root\Straumvakt-parked";       What='OpenADR / Dynamic Grid report — not a git worktree' },
  @{ Id='P2'; Path="$Root\Straumvakt\docs\OCPP";    What='Official OCPP 1.6 / 2.0.1 / 2.1 specifications — untracked' },
  @{ Id='P3'; Path="$Root\Straumvakt\archive";      What='Archive folders incl. mobile vehicle concept' },
  @{ Id='P5'; Path="$Root\CPMS";                    What='Provenance for the hlada name and the OCPP design' }
)
foreach ($p in $preserve) {
  if (Test-Path $p.Path) {
    $n = (Get-ChildItem $p.Path -Recurse -File -Force -ErrorAction SilentlyContinue |
          Where-Object { -not ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) }).Count
    Emit ("  {0}  PRESENT  {1,6} files  {2}" -f $p.Id, $n, $p.Path)
  } else {
    Emit ("  {0}  *** MISSING ***      {1}   <-- STOP" -f $p.Id, $p.Path)
  }
}
Emit "  P4  MANUAL   C:\Users\Andri\Documents\New project  (prompts/evidence — outside any repo)"
Emit ""

# ── 2. Untracked material in the canonical checkout ─────────────────
Emit "== 2. UNTRACKED IN CANONICAL (unrecoverable if deleted) =="
$canon = Join-Path $Root 'Straumvakt'
if (Test-Path (Join-Path $canon '.git')) {
  Push-Location $canon
  $st = & git status --porcelain 2>$null
  Pop-Location
  $untracked = $st | Where-Object { $_ -like '?? *' }
  $modified  = $st | Where-Object { $_ -notlike '?? *' }
  Emit ("  untracked entries: {0}" -f ($untracked | Measure-Object).Count)
  foreach ($u in $untracked) { Emit ("    {0}" -f $u) }
  Emit ("  modified tracked : {0}" -f ($modified | Measure-Object).Count)
} else {
  Emit "  canonical checkout not found"
}
Emit ""

# ── 3. Junctions, in required unlink order ──────────────────────────
Emit "== 3. JUNCTIONS — unlink BEFORE deleting any target =="
Emit "   Use:  cmd /c rmdir `"<junction>`"      <-- NEVER Remove-Item -Recurse"
Emit "   (Remove-Item -Recurse can traverse a junction and delete the TARGET.)"
$junctions = @()
Get-ChildItem $Root -Directory -Filter 'Straumvakt*' -ErrorAction SilentlyContinue | ForEach-Object {
  Get-ChildItem $_.FullName -Recurse -Directory -Depth 3 -Force -ErrorAction SilentlyContinue |
    Where-Object { $_.LinkType } | ForEach-Object {
      $tgt = ($_.Target -join ',')
      $crosses = $tgt -and ($tgt -notlike ($_.FullName.Substring(0, $_.FullName.IndexOf('\', $Root.Length + 1) + 1) + '*'))
      $junctions += [PSCustomObject]@{ Junction = $_.FullName; Target = $tgt; CrossWorktree = $crosses }
    }
}
$cross = $junctions | Where-Object CrossWorktree
Emit ("  total junctions: {0}   cross-worktree: {1}" -f $junctions.Count, ($cross | Measure-Object).Count)
foreach ($j in $cross) { Emit ("    CROSS  {0}`n           -> {1}" -f $j.Junction, $j.Target) }
Emit ""

# ── 4. Reclaimable space, junctions excluded ────────────────────────
Emit "== 4. RECLAIMABLE BUILD OUTPUT (regenerable — npm install / flutter pub get) =="
$rows = @()
Get-ChildItem $Root -Directory -ErrorAction SilentlyContinue | ForEach-Object {
  $t = 0L; $b = 0L
  Get-ChildItem $_.FullName -Recurse -File -Force -ErrorAction SilentlyContinue |
    Where-Object { -not ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) } |
    ForEach-Object {
      $t += $_.Length
      if ($_.FullName -match '\\(node_modules|\.next|\.open-next|\.dart_tool|build)\\') { $b += $_.Length }
    }
  $rows += [PSCustomObject]@{
    Name = $_.Name
    TotalGB = [math]::Round($t/1GB, 2)
    ReclaimGB = [math]::Round($b/1GB, 2)
    ContentMB = [math]::Round(($t - $b)/1MB, 1)
  }
}
$rows | Sort-Object ReclaimGB -Descending | ForEach-Object {
  Emit ("  {0,-38} total {1,7} GB   reclaim {2,7} GB   content {3,9} MB" -f $_.Name, $_.TotalGB, $_.ReclaimGB, $_.ContentMB)
}
Emit ("  TOTALS: {0} GB total | {1} GB reclaimable | {2} GB content" -f `
  [math]::Round(($rows | Measure-Object TotalGB -Sum).Sum, 2),
  [math]::Round(($rows | Measure-Object ReclaimGB -Sum).Sum, 2),
  [math]::Round((($rows | Measure-Object ContentMB -Sum).Sum)/1024, 2))
Emit ""

# ── 5. Worktrees with zero unique commits ───────────────────────────
Emit "== 5. WORKTREES WITH ZERO UNIQUE COMMITS vs the release candidate =="
Emit "   (safe to RETIRE — the branch survives; only the working copy goes)"
$rcRef = '4b69d0f'
Get-ChildItem $Root -Directory -Filter 'Straumvakt*' -ErrorAction SilentlyContinue | ForEach-Object {
  $g = Join-Path $_.FullName '.git'
  if (Test-Path $g) {
    Push-Location $_.FullName
    $tip    = (& git rev-parse --short HEAD 2>$null)
    $dirty  = ((& git status --porcelain 2>$null) | Measure-Object).Count
    $unique = (& git rev-list --count "$rcRef..HEAD" 2>$null)
    Pop-Location
    if ($unique -eq '0') {
      Emit ("  {0,-38} tip {1,-9} dirty={2,-3} unique=0" -f $_.Name, $tip, $dirty)
    }
  }
}
Emit ""

Emit "== NEXT STEPS (none performed by this script) =="
Emit "  1. Copy P1-P4 out and hash-verify."
Emit "  2. Commit docs/OCPP and the research report."
Emit "  3. Unlink cross-worktree junctions with cmd /c rmdir."
Emit "  4. THEN, with approval, prune build output."
Emit "  5. Retire zero-unique worktrees; branches survive."
Emit ""
Emit "This script deleted nothing. It contains no delete verb."

if ($OutFile) {
  if ($OutFile -like "$Root*") { Write-Warning "Refusing to write the manifest inside $Root; choose a path outside it." }
  else { $lines | Set-Content -Path $OutFile -Encoding utf8; Write-Host "`nManifest written to $OutFile" }
}
