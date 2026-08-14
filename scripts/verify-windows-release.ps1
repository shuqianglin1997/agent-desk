param(
  [Parameter(Mandatory = $false)]
  [string] $ReleaseDir = 'release',

  [Parameter(Mandatory = $false)]
  [string] $ExpectedSignerThumbprint = $env:WIN_SIGNER_THUMBPRINT
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$codeSigningEkuOid = '1.3.6.1.5.5.7.3.3'
$timeStampingEkuOid = '1.3.6.1.5.5.7.3.8'

function Normalize-Thumbprint {
  param(
    [Parameter(Mandatory = $true)]
    [string] $Thumbprint
  )

  return ($Thumbprint -replace '[^A-Fa-f0-9]', '').ToUpperInvariant()
}

function Get-CertificateEkuOids {
  param(
    [Parameter(Mandatory = $true)]
    [System.Security.Cryptography.X509Certificates.X509Certificate2] $Certificate
  )

  $ekuExtension = $Certificate.Extensions |
    Where-Object { $_.Oid.Value -eq '2.5.29.37' } |
    Select-Object -First 1

  if ($null -eq $ekuExtension) {
    return @()
  }

  return @($ekuExtension.EnhancedKeyUsages | ForEach-Object { $_.Value })
}

function Assert-TrustedTimestampedSignature {
  param(
    [Parameter(Mandatory = $true)]
    [string] $Path,

    [Parameter(Mandatory = $true)]
    [string] $Label,

    [Parameter(Mandatory = $false)]
    [string] $ExpectedSignerThumbprint = ''
  )

  $signature = Get-AuthenticodeSignature -LiteralPath $Path
  if ($signature.Status -ne [System.Management.Automation.SignatureStatus]::Valid) {
    throw "$Label does not have a trusted Authenticode signature: $($signature.Status) — $($signature.StatusMessage)"
  }
  if ($null -eq $signature.SignerCertificate) {
    throw "$Label has no Authenticode signer certificate."
  }

  $signerEkus = @(Get-CertificateEkuOids -Certificate $signature.SignerCertificate)
  if ($signerEkus -notcontains $codeSigningEkuOid) {
    throw "$Label signer certificate is missing the Code Signing EKU ($codeSigningEkuOid)."
  }

  if ($null -eq $signature.TimeStamperCertificate) {
    throw "$Label is signed but has no trusted RFC 3161 timestamp."
  }
  $timestampEkus = @(Get-CertificateEkuOids -Certificate $signature.TimeStamperCertificate)
  if ($timestampEkus -notcontains $timeStampingEkuOid) {
    throw "$Label timestamp certificate is missing the Time Stamping EKU ($timeStampingEkuOid)."
  }

  $actualThumbprint = $signature.SignerCertificate.Thumbprint.ToUpperInvariant()
  if (-not [string]::IsNullOrWhiteSpace($ExpectedSignerThumbprint) -and
      $actualThumbprint -ne $ExpectedSignerThumbprint.ToUpperInvariant()) {
    throw "$Label signer certificate does not match the required publisher identity."
  }

  Write-Host "Verified $Label Authenticode signer: $($signature.SignerCertificate.Subject)"
  Write-Host "Verified $Label RFC 3161 timestamp authority: $($signature.TimeStamperCertificate.Subject)"
  return $actualThumbprint
}

function Resolve-SevenZip {
  foreach ($candidate in @('7z.exe', '7za.exe', '7z', '7za')) {
    $command = Get-Command $candidate -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($null -ne $command) {
      return $command.Path
    }
  }

  throw '7-Zip is required to inspect the final portable executable, but 7z/7za was not found on PATH.'
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
  & $SevenZip 'x' '-bd' '-y' "-o$Destination" $Archive
  if ($LASTEXITCODE -ne 0) {
    throw "7-Zip could not inspect $Archive (exit code $LASTEXITCODE)."
  }
}

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$packagePath = Join-Path $repositoryRoot 'package.json'
$packageJson = Get-Content -LiteralPath $packagePath -Raw | ConvertFrom-Json
$expectedPortableName = "AgentDesk-$($packageJson.version)-portable-x64.exe"

if ([string]::IsNullOrWhiteSpace($ExpectedSignerThumbprint)) {
  throw 'ExpectedSignerThumbprint/WIN_SIGNER_THUMBPRINT is required before inspecting a Windows release payload.'
}
$requiredPublisherThumbprint = Normalize-Thumbprint -Thumbprint $ExpectedSignerThumbprint
if ($requiredPublisherThumbprint -notmatch '^[A-F0-9]{40}$') {
  throw 'ExpectedSignerThumbprint/WIN_SIGNER_THUMBPRINT must contain exactly one 40-hex certificate thumbprint.'
}

$resolvedReleaseDir = (Resolve-Path -LiteralPath $ReleaseDir).Path
$portableCandidates = @(
  Get-ChildItem -LiteralPath $resolvedReleaseDir -File |
    Where-Object { $_.Name -like 'AgentDesk-*-portable-*.exe' }
)
if ($portableCandidates.Count -ne 1) {
  throw "Expected exactly one AgentDesk portable executable in $resolvedReleaseDir; found $($portableCandidates.Count)."
}

$portable = $portableCandidates[0]
if ($portable.Name -cne $expectedPortableName) {
  throw "Expected portable artifact $expectedPortableName; found $($portable.Name)."
}

$outerSignerThumbprint = Assert-TrustedTimestampedSignature `
  -Path $portable.FullName `
  -Label 'outer Windows portable executable' `
  -ExpectedSignerThumbprint $requiredPublisherThumbprint

$sevenZip = Resolve-SevenZip
$temporaryRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("agentdesk-release-verify-" + [guid]::NewGuid().ToString('N'))

try {
  $outerDirectory = Join-Path (Join-Path $temporaryRoot 'outer') 'win-unpacked'
  Expand-WithSevenZip -SevenZip $sevenZip -Archive $portable.FullName -Destination $outerDirectory

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

    $payloadDirectory = Join-Path (Join-Path $temporaryRoot 'payload') 'win-unpacked'
    Expand-WithSevenZip -SevenZip $sevenZip -Archive $nestedArchives[0].FullName -Destination $payloadDirectory
    $appCandidates = @(Get-ChildItem -LiteralPath $payloadDirectory -Recurse -File -Filter 'AgentDesk.exe')
  }

  if ($appCandidates.Count -ne 1) {
    throw "Expected exactly one AgentDesk.exe inside the final portable artifact; found $($appCandidates.Count)."
  }

  $innerApp = $appCandidates[0]
  $packageIntegrityVerifier = Join-Path $repositoryRoot 'scripts\verify-electron-package-integrity.js'
  & node $packageIntegrityVerifier '--artifact' $innerApp.Directory.FullName
  if ($LASTEXITCODE -ne 0) {
    throw "Electron fuse and ASAR verification failed inside the final portable artifact (exit code $LASTEXITCODE)."
  }

  $expectedHelperPath = Join-Path $innerApp.Directory.FullName 'resources\native\AgentDeskInputHelper.exe'
  $allHelpers = @(
    Get-ChildItem -LiteralPath $temporaryRoot -Recurse -File -Filter 'AgentDeskInputHelper.exe'
  )
  if ($allHelpers.Count -ne 1) {
    throw "Expected exactly one AgentDeskInputHelper.exe inside the final portable artifact; found $($allHelpers.Count)."
  }
  if (-not (Test-Path -LiteralPath $expectedHelperPath -PathType Leaf)) {
    throw 'AgentDeskInputHelper.exe is not in the fixed resources/native location beside the packaged app.'
  }

  $resolvedHelperPath = (Resolve-Path -LiteralPath $expectedHelperPath).Path
  if ($resolvedHelperPath -cne $allHelpers[0].FullName) {
    throw 'The portable artifact contains an unexpected duplicate or relocated input helper.'
  }

  Assert-TrustedTimestampedSignature `
    -Path $innerApp.FullName `
    -Label 'packaged AgentDesk.exe' `
    -ExpectedSignerThumbprint $outerSignerThumbprint | Out-Null

  Assert-TrustedTimestampedSignature `
    -Path $resolvedHelperPath `
    -Label 'packaged AgentDeskInputHelper.exe' `
    -ExpectedSignerThumbprint $outerSignerThumbprint | Out-Null

  Write-Host "Windows release verification passed: $($portable.FullName)"
} finally {
  if (Test-Path -LiteralPath $temporaryRoot) {
    [System.IO.Directory]::Delete($temporaryRoot, $true)
  }
}
