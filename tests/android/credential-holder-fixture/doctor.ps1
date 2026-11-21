# DISHA credential-holder fixture Windows environment doctor.
# Run from repository root: powershell -ExecutionPolicy Bypass -File tests/android/credential-holder-fixture/doctor.ps1
# -RepairLocalTools only restarts local ADB and Gradle daemons. It never changes an Android account,
# reinstalls GMS, modifies developer settings, or changes transaction state.
[CmdletBinding()]
param(
    [switch]$RepairLocalTools,
    [switch]$SkipBuild
)
$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = (Resolve-Path (Join-Path $project '../../..')).Path
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$logDir = Join-Path $project ("local-diagnostics/" + $stamp)
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
function Save-CommandOutput([string]$label, [string]$exe, [string[]]$arguments) {
    $file = Join-Path $logDir ($label + '.txt')
    "Command: $exe $($arguments -join ' ')" | Set-Content -Encoding UTF8 $file
    try {
        $output = & $exe @arguments 2>&1 | Out-String
        $status = $LASTEXITCODE
        $output | Add-Content -Encoding UTF8 $file
        "ExitCode: $status" | Add-Content -Encoding UTF8 $file
        Write-Host ("[{0}] exit={1}" -f $label,$status)
        return $output
    } catch {
        "ERROR: $($_.Exception.Message)" | Add-Content -Encoding UTF8 $file
        Write-Host "[$label] failed: $($_.Exception.Message)"
        return ''
    }
}
function Find-Executable([string]$name, [string[]]$candidates) {
    foreach ($candidate in $candidates) {
        if ($candidate -and (Test-Path $candidate)) {
            return (Resolve-Path $candidate).Path
        }
    }
    $resolved = Get-Command $name -ErrorAction SilentlyContinue
    if ($resolved) { return $resolved.Source }
    return $null
}
$androidSdk = $env:ANDROID_HOME
if (-not $androidSdk) { $androidSdk = $env:ANDROID_SDK_ROOT }
if (-not $androidSdk) {
    $androidSdk = Join-Path $env:LOCALAPPDATA 'Android/Sdk'
}
$adb = Find-Executable 'adb.exe' @((Join-Path $androidSdk 'platform-tools/adb.exe'))
$emulator = Find-Executable 'emulator.exe' @((Join-Path $androidSdk 'emulator/emulator.exe'))
$gradle = Find-Executable 'gradle.bat' @((Join-Path $root 'gradlew.bat'))
if (-not $gradle) { $gradle = Find-Executable 'gradle.bat' @() }
@(
    "Repository=$root"
    "Project=$project"
    "SDK=$androidSdk"
    "JavaHome=$env:JAVA_HOME"
    "ADB=$adb"
    "Emulator=$emulator"
    "Gradle=$gradle"
    "RepairLocalTools=$RepairLocalTools"
) | Set-Content -Encoding UTF8 (Join-Path $logDir 'environment.txt')
Write-Host "DISHA diagnostics: $logDir"
if (-not $adb) {
    Write-Host 'ADB_MISSING: Check Android Studio SDK Manager > Android SDK Platform-Tools.'
} else {
    Save-CommandOutput 'adb-version' $adb @('version') | Out-Null
    if ($RepairLocalTools) {
        Save-CommandOutput 'adb-kill-server' $adb @('kill-server') | Out-Null
        Save-CommandOutput 'adb-start-server' $adb @('start-server') | Out-Null
    }
    $devices = Save-CommandOutput 'adb-devices' $adb @('devices','-l')
    if ($devices -notmatch '(?m)^\S+\s+device\b') {
        Write-Host 'NO_ONLINE_EMULATOR: Start Android 36 Google Play AVD in Device Manager.'
    } else {
        Save-CommandOutput 'device-api' $adb @('shell','getprop','ro.build.version.sdk') | Out-Null
        Save-CommandOutput 'device-image' $adb @('shell','getprop','ro.build.fingerprint') | Out-Null
        Save-CommandOutput 'device-gms-version' $adb @('shell','dumpsys','package','com.google.android.gms') | Out-Null
        Save-CommandOutput 'device-gms-features' $adb @('shell','pm','list','features') | Out-Null
        Save-CommandOutput 'device-fixture' $adb @('shell','dumpsys','package','ai.disha.credentialfixture') | Out-Null
        Save-CommandOutput 'device-logcat' $adb @('logcat','-d','-s','DISHA_CREDENTIAL_FIXTURE:V','RegistryManager:V','CredentialManager:V','* :S') | Out-Null
        Write-Host 'If registration shows 17/API_NOT_CONNECTED, investigate GMS API eligibility; do not modify the payment ledger.'
    }
}
if ($emulator) { Save-CommandOutput 'emulator-list' $emulator @('-list-avds') | Out-Null }
if (-not $gradle) {
    Write-Host 'GRADLE_MISSING: Add Gradle 8.11.1 to PATH or use Android Studio Gradle sync.'
} elseif (-not $SkipBuild) {
    if ($RepairLocalTools) {
        Save-CommandOutput 'gradle-stop' $gradle @('--stop') | Out-Null
    }
    # In a workspace containing multiple projects, -p selects the isolated fixture.
    Save-CommandOutput 'gradle-build' $gradle @('-p',$project,':app:assembleDebug','--no-daemon','--stacktrace','--console=plain') | Out-Null
}
Write-Host "DIAGNOSTICS_COMPLETE: $logDir"
Write-Host 'Share diagnostics only after reviewing log files for personal data.'
