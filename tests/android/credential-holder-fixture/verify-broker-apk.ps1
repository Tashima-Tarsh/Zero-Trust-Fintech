param(
    [Parameter(Mandatory = $true)][string]$Apk,
    [Parameter(Mandatory = $true)][string]$BuildTools
)

$ErrorActionPreference = 'Stop'
$apkPath = (Resolve-Path -LiteralPath $Apk).Path
$aapt = Join-Path $BuildTools 'aapt.exe'
$apksigner = Join-Path $BuildTools 'apksigner.bat'

$badging = & $aapt dump badging $apkPath
if ($LASTEXITCODE -ne 0 -or -not ($badging -match "^package: name='ai\.disha\.credentialfixture' ")) {
    throw 'Unexpected broker package identity'
}
$manifest = (& $aapt dump xmltree $apkPath AndroidManifest.xml) -join "`n"
if ($LASTEXITCODE -ne 0) { throw 'Could not inspect the APK manifest' }

foreach ($required in @(
    'ai.disha.credentialfixture.PlatformObservationBrokerActivity',
    'ai.disha.credentialfixture.PaymentObservationListener',
    'android.permission.BIND_NOTIFICATION_LISTENER_SERVICE',
    'android.service.notification.NotificationListenerService'
)) {
    if (-not $manifest.Contains($required)) { throw "Missing broker manifest entry: $required" }
}
foreach ($forbidden in @(
    'ai.disha.credentialfixture.RegisterActivity',
    'ai.disha.credentialfixture.PresentActivity',
    'ai.disha.credentialfixture.SessionObservationActivity',
    'ai.disha.credentialfixture.DishaCredentialApplication',
    'android.permission.POST_NOTIFICATIONS'
)) {
    if ($manifest.Contains($forbidden)) { throw "Unexpected fixture manifest entry: $forbidden" }
}

$signing = & $apksigner verify --print-certs $apkPath
if ($LASTEXITCODE -ne 0) { throw 'APK signature verification failed' }
$fingerprints = @($signing | Select-String '^Signer #\d+ certificate SHA-256 digest: [0-9a-f]{64}$')
if ($fingerprints.Count -ne 1) { throw 'Expected one APK signing certificate' }
[pscustomobject]@{
    Package = 'ai.disha.credentialfixture'
    ApkSha256 = (Get-FileHash -LiteralPath $apkPath -Algorithm SHA256).Hash
    CertificateSha256 = ($fingerprints[0].Line -split ': ', 2)[1]
    ManifestCheck = 'PASS'
}
