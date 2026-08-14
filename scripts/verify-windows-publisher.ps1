param(
  [Parameter(Mandatory = $false)]
  [string] $ReleaseDir = 'release',

  [Parameter(Mandatory = $false)]
  [string] $ExpectedSignerThumbprint = $env:WIN_SIGNER_THUMBPRINT
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Normalize-Thumbprint {
  param(
    [Parameter(Mandatory = $true)]
    [string] $Thumbprint
  )

  return ($Thumbprint -replace '[^A-Fa-f0-9]', '').ToUpperInvariant()
}

if ([string]::IsNullOrWhiteSpace($ExpectedSignerThumbprint)) {
  throw 'WIN_SIGNER_THUMBPRINT is required; accepting an arbitrary trusted publisher is forbidden.'
}

$expected = Normalize-Thumbprint -Thumbprint $ExpectedSignerThumbprint
if ($expected -notmatch '^[A-F0-9]{40}$') {
  throw 'WIN_SIGNER_THUMBPRINT must contain exactly one 40-hex certificate thumbprint.'
}

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$packageJson = Get-Content -LiteralPath (Join-Path $repositoryRoot 'package.json') -Raw | ConvertFrom-Json
$expectedPortableName = "AgentDesk-$($packageJson.version)-portable-x64.exe"
$resolvedReleaseDir = (Resolve-Path -LiteralPath $ReleaseDir).Path
$portableCandidates = @(
  Get-ChildItem -LiteralPath $resolvedReleaseDir -File |
    Where-Object { $_.Name -ceq $expectedPortableName }
)
if ($portableCandidates.Count -ne 1) {
  throw "Expected exactly one $expectedPortableName in $resolvedReleaseDir; found $($portableCandidates.Count)."
}

$signature = Get-AuthenticodeSignature -LiteralPath $portableCandidates[0].FullName
if ($signature.Status -ne [System.Management.Automation.SignatureStatus]::Valid -or
    $null -eq $signature.SignerCertificate) {
  throw "The Windows portable does not have a trusted Authenticode signer: $($signature.Status)."
}

$actual = Normalize-Thumbprint -Thumbprint $signature.SignerCertificate.Thumbprint
if ($actual -cne $expected) {
  throw 'The Windows portable publisher does not match the protected WIN_SIGNER_THUMBPRINT identity.'
}

Write-Host "Verified expected Windows publisher: $($signature.SignerCertificate.Subject)"
