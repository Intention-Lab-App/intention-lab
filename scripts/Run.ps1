param([int]$Port=29871,[switch]$NoBrowser)
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$env:INTENTIONLAB_PORT="$Port"
$env:INTENTIONLAB_APP_DIR=Join-Path $root 'app'
dotnet build (Join-Path $root 'bridge\DeviceBridge.csproj') -c Debug
if($LASTEXITCODE -ne 0){throw 'Bridge build failed'}
$dll=Join-Path $root 'bridge\bin\Debug\net10.0\DeviceBridge.dll'
$arguments='"'+$dll+'"'
if($NoBrowser){$arguments+=' --no-browser'}
Start-Process -FilePath dotnet -ArgumentList $arguments -WindowStyle Hidden
