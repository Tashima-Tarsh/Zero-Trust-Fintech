# DISHA — REA + Android Studio investigation, user-level only.
# Run from PowerShell in the DISHA repository checkout.
# Does not install APKs, change production, invoke payments, or read account data.
param(
 [ValidateSet('Setup','Inspect','All')][string]$Mode='All',
 [string]$Serial='emulator-5554',
 [string]$Adb='adb',
 [string]$OutputDir='',
 [switch]$SkipReaSetup
)
$ErrorActionPreference='Stop'
function Exec([string]$Binary,[string[]]$Arguments){
  & $Binary @Arguments
  if($LASTEXITCODE -ne 0){throw "Command failed: $Binary $($Arguments -join ' ')"}
}
function NodeCompatible([string]$v){
  $m=[regex]::Match($v,'^v?(\d+)\.(\d+)\.(\d+)')
  if(-not $m.Success){return $false}
  $major=[int]$m.Groups[1].Value;$minor=[int]$m.Groups[2].Value;$patch=[int]$m.Groups[3].Value
  return (($major -eq 22 -and ($minor -gt 23 -or ($minor -eq 23 -and $patch -ge 4))) -or
    ($major -eq 24 -and ($minor -gt 22 -or ($minor -eq 22 -and $patch -ge 1))) -or
    ($major -eq 26 -and ($minor -gt 12 -or ($minor -eq 12 -and $patch -ge 1))) -or
    ($major -gt 26))
}
if($Mode -in @('Setup','All')){
  $nodeV=(& node --version 2>$null)
  if($LASTEXITCODE -ne 0 -or -not (NodeCompatible $nodeV)){
    throw "REA requires Node 22.23.4+, 24.22.1+, or 26.12.1+. Found $nodeV. Update Node LTS; rerun this script."
  }
  Write-Host "REA Node prerequisite PASS: $nodeV"
  if(-not $SkipReaSetup){
    # Official package install command registers REA MCP for supported agent(s).
    # No arbitrary remote PowerShell script is executed.
    Exec 'npx' @('--yes','rea-agents','setup')
    Write-Host 'REA setup invoked. Restart Codex / your MCP-enabled agent before testing REA tools.'
  }
}
if($Mode -in @('Inspect','All')){
  if(-not $OutputDir){$OutputDir=Join-Path (Get-Location) 'rea-android-observations'}
  $dest=[IO.Path]::GetFullPath($OutputDir)
  [void][IO.Directory]::CreateDirectory($dest)
  function SaveAdb([string]$File,[string[]]$ArgsList){
    $lines=(& $Adb '-s' $Serial @ArgsList 2>&1 | Out-String)
    Set-Content -LiteralPath (Join-Path $dest $File) -Value $lines -Encoding utf8
    Write-Host "$File captured"
  }
  SaveAdb 'adb-device.txt' @('get-state')
  SaveAdb 'android-version.txt' @('shell','getprop','ro.build.version.release')
  $chromeDump=(& $Adb '-s' $Serial 'shell' 'dumpsys' 'package' 'com.android.chrome' 2>&1 | Out-String)
  Set-Content -LiteralPath (Join-Path $dest 'chrome-version.txt') -Value (($chromeDump -split "`n") | Where-Object {$_ -match 'versionName='} | Select-Object -First 4) -Encoding utf8
  $packages=(& $Adb '-s' $Serial 'shell' 'pm' 'list' 'packages' 2>&1)
  Set-Content -LiteralPath (Join-Path $dest 'installed-payment-packages.txt') -Value ($packages | Where-Object {$_ -match 'gms|paisa|paytm|phonepe|chromium|chrome'}) -Encoding utf8
  SaveAdb 'upi-intent-activities.txt' @('shell','cmd','package','query-activities','--brief','-a','android.intent.action.VIEW','-d','upi://pay?pa=fixture@invalid&pn=DISHA&am=1.05&cu=INR')
  SaveAdb 'chromium-pay-intent-activities.txt' @('shell','cmd','package','query-activities','--brief','-a','org.chromium.intent.action.PAY')
  SaveAdb 'gms-pay-intent-activities.txt' @('shell','cmd','package','query-activities','--brief','-a','com.google.android.gms.pay.PAY')
  $gmsDump=(& $Adb '-s' $Serial 'shell' 'dumpsys' 'package' 'com.google.android.gms' 2>&1)
  $gmsLines=$gmsDump | Select-String -Pattern 'org.chromium.intent.action.PAY|IS_READY_TO_PAY|com.google.android.gms.pay.PAY|ChooseAccountShimActivity|PayImplicitIntentActivity' -Context 3,5
  Set-Content -LiteralPath (Join-Path $dest 'gms-payment-intents.txt') -Value ($gmsLines | Out-String) -Encoding utf8
  Write-Host 'Review/redact captured package dumps before sharing. Do not commit device logs or private app data.'
  Write-Host "Output folder: $dest"
}
