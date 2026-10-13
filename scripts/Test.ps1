param([switch]$Browser,[switch]$Hardware)
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
Push-Location $root
try {
 node --test tests/*.test.js
 if($LASTEXITCODE -ne 0){throw 'Core tests failed'}
 dotnet run --project tests/bridge/BridgeChecks.csproj -c Release
 if($LASTEXITCODE -ne 0){throw 'Bridge tests failed'}
 node tests/null-experiments.mjs
 if($LASTEXITCODE -ne 0){throw 'Simulation checks failed'}
 node tests/score-calibration.mjs
 if($LASTEXITCODE -ne 0){throw 'Score calibration failed'}
 if($Browser){
  foreach($suite in 'results','ui-review','browser','ui-sessions','review','failures'){
   node "tests/$suite.mjs"
   if($LASTEXITCODE -ne 0){throw "Browser suite $suite failed"}
  }
 }
 if($Hardware){
  foreach($suite in 'hardware','reference','ownership'){
   node "tests/$suite.mjs"
   if($LASTEXITCODE -ne 0){throw "Hardware suite $suite failed"}
  }
 }
} finally {Pop-Location}
