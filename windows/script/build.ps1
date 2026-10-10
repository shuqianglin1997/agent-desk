param([ValidateSet('Build','Run','Publish','Package','Test')][string]$Action='Build',[string]$Dotnet='dotnet')
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
$project=Join-Path $root 'src/AgentDeskNative.App/AgentDeskNative.App.csproj'
if($Action -eq 'Test'){
    & $Dotnet run --project (Join-Path $root 'tests/AgentDeskNative.Core.Tests/AgentDeskNative.Core.Tests.csproj')
}elseif($Action -in @('Publish','Package')){
    & $Dotnet publish $project -c Release -r win-x64 --self-contained true -o (Join-Path $root '../dist.noindex/windows/AgentDeskNative')
}elseif($Action -eq 'Run'){
    & $Dotnet run --project $project -- --show
}else{
    & $Dotnet build $project -c Release
}
if($LASTEXITCODE -ne 0){throw "Windows $Action failed ($LASTEXITCODE)"}
if ($Action -eq 'Package') {
    $version = (Get-Content -LiteralPath (Join-Path $root 'VERSION') -Raw).Trim()
    $release = Join-Path $root '../dist.noindex/windows/releases'
    New-Item -ItemType Directory -Path $release -Force | Out-Null
    $zip = Join-Path $release "AgentDeskNative-Windows-$version-x64.zip"
    Compress-Archive -Path (Join-Path $root '../dist.noindex/windows/AgentDeskNative/*') -DestinationPath $zip -Force
    $hash = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant()
    [IO.File]::WriteAllText((Join-Path $release 'SHA256SUMS'), "$hash  $([IO.Path]::GetFileName($zip))`n", [Text.UTF8Encoding]::new($false))
    Write-Output $zip
}
