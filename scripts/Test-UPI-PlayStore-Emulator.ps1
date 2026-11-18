# DISHA 8.2 — official Google Play emulator installer / read-only app probe.
# Usage: .\scripts\Test-UPI-PlayStore-Emulator.ps1
# Repeat after manually installing the apps: .\scripts\Test-UPI-PlayStore-Emulator.ps1 -InspectOnly
# Never use untrusted APK mirrors or attempt a real UPI payment on an emulator.
[CmdletBinding()]
param(
    [switch]$InspectOnly,
    [switch]$SkipStore,
    [string]$AvdName = 'DISHA_GPay_API35'
)
$ErrorActionPreference = 'Stop'
function Get-AndroidSdk {
    $candidates = @($env:ANDROID_SDK_ROOT, $env:ANDROID_HOME)
    if ($env:LOCALAPPDATA) { $candidates += (Join-Path $env:LOCALAPPDATA 'Android\Sdk') }
    foreach ($candidate in $candidates) {
        if ($candidate -and (Test-Path -LiteralPath $candidate -PathType Container)) {
            return $candidate
        }
    }
    throw 'Android SDK was not found. Install Android Studio with SDK Manager, then rerun this script.'
}
function Require-Tool($path,$label) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw "$label not found at $path. Use Android Studio SDK Manager to install this SDK component."
    }
    return $path
}
$sdk = Get-AndroidSdk
$adb = Join-Path $sdk 'platform-tools\adb.exe'
$emulator = Join-Path $sdk 'emulator\emulator.exe'
$manager = Join-Path $sdk 'cmdline-tools\latest\bin\sdkmanager.bat'
$avdManager = Join-Path $sdk 'cmdline-tools\latest\bin\avdmanager.bat'
if (-not $InspectOnly) {
    $manager = Require-Tool $manager 'SDK Manager CLI'
    $avdManager = Require-Tool $avdManager 'AVD Manager CLI'
    # This is Google's official Play Store image; not google_apis without Play.
    & $manager '--install' 'platform-tools' 'emulator' 'system-images;android-35;google_apis_playstore;x86_64'
    if ($LASTEXITCODE -ne 0) { throw 'The Google Play Android 35 system-image installation failed.' }
    $emulator = Require-Tool $emulator 'Android Emulator'
    $present = @(& $emulator -list-avds)
    if ($present -notcontains $AvdName) {
        & $avdManager create avd -n $AvdName -k 'system-images;android-35;google_apis_playstore;x86_64' --device 'pixel_6'
        if ($LASTEXITCODE -ne 0) { throw 'Unable to create Play Store AVD.' }
    }
    $booted = @(& $adb devices | Select-String '^emulator-[0-9]+\s+device')
    if ($booted.Count -eq 0) {
        Start-Process -FilePath $emulator -ArgumentList @('-avd',$AvdName,'-no-snapshot-load')
    }
}
$adb = Require-Tool $adb 'Android Debug Bridge (adb)'
$serial = $null
for ($attempt=0; $attempt -lt 90; $attempt++) {
    $devices = @(& $adb devices | Select-String '^(emulator-[0-9]+)\s+device')
    if ($devices.Count -eq 1) {
        $serial = $devices[0].Matches[0].Groups[1].Value
        if ((& $adb -s $serial shell getprop sys.boot_completed).Trim() -eq '1') { break }
    } elseif ($devices.Count -gt 1) {
        throw 'Multiple emulators are running. Close other AVDs so the script does not inspect the wrong device.'
    }
    Start-Sleep -Seconds 2
}
if (-not $serial -or ((& $adb -s $serial shell getprop sys.boot_completed).Trim() -ne '1')) {
    throw 'No fully booted Android emulator is available.'
}
$playStore = @(& $adb -s $serial shell pm path com.android.vending)
if (-not (($playStore -join '') -match 'package:')) {
    throw 'This emulator does not contain Google Play Store. Use the Google Play system image, not Google APIs.'
}
$apps = [ordered]@{
    GooglePayIndia = 'com.google.android.apps.nbu.paisa.user'
    PhonePe = 'com.phonepe.app'
    Paytm = 'net.one97.paytm'
}
if (-not $SkipStore -and -not $InspectOnly) {
    Write-Host 'Opening Google Pay in the official Play Store. Sign into Google manually and choose Install.' -ForegroundColor Cyan
    & $adb -s $serial shell am start -a android.intent.action.VIEW -d 'market://details?id=com.google.android.apps.nbu.paisa.user' -p com.android.vending
    Write-Host 'When finished, install PhonePe from Play Store and run this script again with -InspectOnly.' -ForegroundColor Yellow
    Write-Host 'Official PhonePe Play Store listing: https://play.google.com/store/apps/details?id=com.phonepe.app'
}
$installed = [ordered]@{}
foreach ($entry in $apps.GetEnumerator()) {
    $answer = @(& $adb -s $serial shell pm path $entry.Value)
    $found = (($answer -join '') -match 'package:')
    $installed[$entry.Key] = [ordered]@{ package=$entry.Value; installed=$found }
    Write-Host ("{0}: {1}" -f $entry.Key, $(if($found){'INSTALLED'}else{'NOT INSTALLED'}))
}
$report = [ordered]@{
    emulator=$AvdName
    serial=$serial
    image='android-35/google_apis_playstore/x86_64'
    playStorePresent=$true
    apps=$installed
    transactionValidated=$false
    limitation='App installation or intent resolution on an AVD is not UPI account registration or bank payment acceptance.'
    inspectedAt=(Get-Date).ToUniversalTime().ToString('o')
}
$targetDir = Join-Path (Get-Location) 'test-results\android'
New-Item -Path $targetDir -ItemType Directory -Force | Out-Null
$file = Join-Path $targetDir 'playstore-upi-apps.json'
$report | ConvertTo-Json -Depth 6 | Set-Content -Path $file -Encoding UTF8
Write-Host "Saved non-financial emulator availability report: $file" -ForegroundColor Green
