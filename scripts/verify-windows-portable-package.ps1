param(
  [Parameter(Mandatory = $true)]
  [string] $PortablePath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Resolve-SevenZip {
  foreach ($candidate in @('7z.exe', '7za.exe', '7z', '7za')) {
    $command = Get-Command $candidate -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($null -ne $command) {
      return $command.Path
    }
  }

  throw '7-Zip is required to inspect the Windows portable executable, but 7z/7za was not found on PATH.'
}

function Expand-WithSevenZip {
  param(
    [Parameter(Mandatory = $true)]
    [string] $SevenZip,

    [Parameter(Mandatory = $true)]
    [string] $Archive,

    [Parameter(Mandatory = $true)]
    [string] $Destination
  )

  [System.IO.Directory]::CreateDirectory($Destination) | Out-Null
  # Consume the native command's success stream so callers receive only their
  # explicit return value; otherwise PowerShell would fold the 7-Zip banner and
  # progress lines into Resolve-PortableApplicationRoot's returned path array.
  & $SevenZip 'x' '-bd' '-y' "-o$Destination" $Archive | Out-Host
  $exitCode = $LASTEXITCODE
  if ($exitCode -ne 0) {
    throw "7-Zip could not inspect $Archive (exit code $exitCode)."
  }
}

function Resolve-PortableApplicationRoot {
  param(
    [Parameter(Mandatory = $true)]
    [string] $SevenZip,

    [Parameter(Mandatory = $true)]
    [string] $Portable,

    [Parameter(Mandatory = $true)]
    [string] $TemporaryRoot
  )

  $outerDirectory = Join-Path (Join-Path $TemporaryRoot 'outer') 'win-unpacked'
  Expand-WithSevenZip -SevenZip $SevenZip -Archive $Portable -Destination $outerDirectory

  $appCandidates = @(Get-ChildItem -LiteralPath $outerDirectory -Recurse -File -Filter 'AgentDesk.exe')
  if ($appCandidates.Count -eq 0) {
    $nestedArchives = @(
      Get-ChildItem -LiteralPath $outerDirectory -Recurse -File |
        Where-Object {
          $_.Name -match '\.nsis\.(7z|zip)$' -or
          $_.Name -match '^app[^\\/]*\.(7z|zip)$'
        }
    )
    if ($nestedArchives.Count -eq 0) {
      $nestedArchives = @(
        Get-ChildItem -LiteralPath $outerDirectory -Recurse -File |
          Where-Object { $_.Extension -in @('.7z', '.zip') }
      )
    }
    if ($nestedArchives.Count -ne 1) {
      throw "Expected exactly one embedded application archive; found $($nestedArchives.Count)."
    }

    $payloadDirectory = Join-Path (Join-Path $TemporaryRoot 'payload') 'win-unpacked'
    Expand-WithSevenZip -SevenZip $SevenZip -Archive $nestedArchives[0].FullName -Destination $payloadDirectory
    $appCandidates = @(Get-ChildItem -LiteralPath $payloadDirectory -Recurse -File -Filter 'AgentDesk.exe')
  }

  if ($appCandidates.Count -ne 1) {
    throw "Expected exactly one AgentDesk.exe inside the Windows portable artifact; found $($appCandidates.Count)."
  }

  return $appCandidates[0].Directory.FullName
}

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$packageJson = Get-Content -LiteralPath (Join-Path $repositoryRoot 'package.json') -Raw | ConvertFrom-Json
$expectedPortableName = "AgentDesk-$($packageJson.version)-portable-x64.exe"
$portable = Get-Item -LiteralPath (Resolve-Path -LiteralPath $PortablePath).Path
if (-not $portable.PSIsContainer -and $portable.Name -cne $expectedPortableName) {
  throw "Expected portable artifact $expectedPortableName; found $($portable.Name)."
}
if ($portable.PSIsContainer) {
  throw 'PortablePath must identify the final Windows portable executable, not a directory.'
}

$sevenZip = Resolve-SevenZip
$temporaryRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("agentdesk-portable-package-verify-" + [guid]::NewGuid().ToString('N'))

try {
  $applicationRoot = Resolve-PortableApplicationRoot `
    -SevenZip $sevenZip `
    -Portable $portable.FullName `
    -TemporaryRoot $temporaryRoot

  $packageIntegrityVerifier = Join-Path $repositoryRoot 'scripts\verify-electron-package-integrity.js'
  & node $packageIntegrityVerifier '--artifact' $applicationRoot
  if ($LASTEXITCODE -ne 0) {
    throw "Electron fuse and ASAR verification failed inside the Windows portable artifact (exit code $LASTEXITCODE)."
  }

  $expectedHelperPath = Join-Path $applicationRoot 'resources\native\AgentDeskInputHelper.exe'
  $helperCandidates = @(
    Get-ChildItem -LiteralPath $temporaryRoot -Recurse -File -Filter 'AgentDeskInputHelper.exe'
  )
  if ($helperCandidates.Count -ne 1) {
    throw "Expected exactly one AgentDeskInputHelper.exe inside the Windows portable artifact; found $($helperCandidates.Count)."
  }
  if (-not (Test-Path -LiteralPath $expectedHelperPath -PathType Leaf)) {
    throw 'AgentDeskInputHelper.exe is not in the fixed resources/native location inside the Windows portable artifact.'
  }
  if ((Resolve-Path -LiteralPath $expectedHelperPath).Path -cne $helperCandidates[0].FullName) {
    throw 'The Windows portable artifact contains an unexpected duplicate or relocated input helper.'
  }

  Write-Host "Windows portable package integrity passed: $($portable.FullName)"
} finally {
  if (Test-Path -LiteralPath $temporaryRoot) {
    [System.IO.Directory]::Delete($temporaryRoot, $true)
  }
}
