param([string]$Output,[ValidateSet('win-x64','linux-x64')][string]$Runtime='win-x64')
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
# Forward slashes keep the script usable from PowerShell on Linux as well.
if(!$Output){$Output=Join-Path $root $(if($Runtime -eq 'win-x64'){'dist/IntentionLab'}else{"dist/IntentionLab-$Runtime"})}
$resolved=[IO.Path]::GetFullPath($Output)
$workspace=[IO.Path]::GetFullPath((Join-Path $root 'dist'))+[IO.Path]::DirectorySeparatorChar
if(!$resolved.StartsWith($workspace,[StringComparison]::OrdinalIgnoreCase)){throw 'Publish output must be a subfolder within IntentionLab/dist.'}
if(Test-Path -LiteralPath $resolved){
  $ancestors=Get-Item -LiteralPath $resolved
  while($ancestors -and $ancestors.FullName.StartsWith($root,[StringComparison]::OrdinalIgnoreCase)){
    if($ancestors.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Publish output cannot traverse a filesystem link.'}
    $ancestors=$ancestors.Parent
  }
}
# Never pull the folder out from under a running copy.
$running=Get-Process DeviceBridge -ErrorAction SilentlyContinue | Where-Object {$_.Path -and $_.Path.StartsWith($resolved,[StringComparison]::OrdinalIgnoreCase)}
if($running){throw "Intention Lab is running from $resolved (process $($running.Id -join ', ')). Quit it first: Settings, Quit."}
if(Test-Path -LiteralPath $resolved){Remove-Item -LiteralPath $resolved -Recurse -Force}
$project=Join-Path $root 'bridge/DeviceBridge.csproj'
if($Runtime -eq 'win-x64'){
  # The Native AOT linker step locates MSVC through vswhere.exe. Some shells (Git
  # Bash) drop the ProgramFiles(x86) variable, and vcvarsall calls vswhere by name,
  # so restore the variable and put the Visual Studio Installer folder on PATH.
  $pf86=${env:ProgramFiles(x86)}
  if(!$pf86){$pf86=[Environment]::GetFolderPath('ProgramFilesX86');[Environment]::SetEnvironmentVariable('ProgramFiles(x86)',$pf86,'Process')}
  $installer=Join-Path $pf86 'Microsoft Visual Studio\Installer'
  if((Test-Path -LiteralPath $installer) -and ($env:PATH -notlike "*$installer*")){$env:PATH="$installer;$env:PATH"}
  dotnet publish $project -c Release -r win-x64 -p:RuntimeFrameworkVersion=10.0.12 -o $resolved
  if($LASTEXITCODE -ne 0){throw 'Native AOT publish failed'}
}else{
  # Native AOT cannot cross-compile from Windows to Linux, so Linux gets a
  # compressed, self-contained single file: no .NET install needed on the target.
  # It is not trimmed, so it matches the tested build on any build machine.
  dotnet publish $project -c Release -r $Runtime -p:PublishAot=false -p:SelfContained=true -p:PublishSingleFile=true -p:EnableCompressionInSingleFile=true -p:RuntimeFrameworkVersion=10.0.12 -o $resolved
  if($LASTEXITCODE -ne 0){throw 'Linux publish failed'}
}
Get-ChildItem -LiteralPath $resolved -Filter '*.pdb' | ForEach-Object {Remove-Item -LiteralPath $_.FullName}
$unusedManifest=Join-Path $resolved 'DeviceBridge.staticwebassets.endpoints.json'
if(Test-Path -LiteralPath $unusedManifest){Remove-Item -LiteralPath $unusedManifest}
Copy-Item -LiteralPath (Join-Path $root 'app') -Destination (Join-Path $resolved 'app') -Recurse
foreach($file in 'LICENSE','CHANGELOG.md'){Copy-Item -LiteralPath (Join-Path $root $file) -Destination $resolved}
# The README's pictures travel with it, in a plain images folder.
Copy-Item -LiteralPath (Join-Path $root '.github/images') -Destination (Join-Path $resolved 'images') -Recurse
[IO.File]::WriteAllText((Join-Path $resolved 'README.md'),[IO.File]::ReadAllText((Join-Path $root 'README.md')).Replace('.github/images/','images/'))
Write-Host "Portable $Runtime folder: $resolved"
