# DISHA synthetic Android SMS -> Chrome transport experiment.
# Requires a running Android emulator, locally running DISHA server on port 3000,
# and no real bank/payment accounts. Never inject real financial credentials.
param(
 [ValidateSet('Open','Debit','Otp','Status')][string]$Mode='Status',
 [string]$Serial='emulator-5554',
 [string]$Adb='adb',
 [string]$Code='',
 [string]$Domain='localhost',
 [int]$Port=3000
)
$ErrorActionPreference='Stop'
function Invoke-Adb([string[]]$ArgsList) {
 & $Adb -s $Serial @ArgsList
 if($LASTEXITCODE -ne 0) { throw "adb failed: $($ArgsList -join ' ')" }
}
Invoke-Adb @('get-state')
switch($Mode){
 'Status' {
  Invoke-Adb @('shell','getprop','sys.boot_completed')
  Invoke-Adb @('shell','getprop','ro.build.version.release')
  Invoke-Adb @('shell','pm','path','com.android.chrome')
 }
 'Open' {
  Invoke-Adb @('reverse',"tcp:$Port","tcp:$Port")
  Invoke-Adb @('shell','am','start','-a','android.intent.action.VIEW',
   '-d',"http://localhost:$Port/labs/sms-transport.html",'com.android.chrome')
  Write-Host "Open Chrome lab, grant test consent and press Start. Do NOT make a payment."
 }
 'Debit' {
  $body='INR 499.01 debited from account XX1234 via UPI. Ref 123456789012. Test synthetic only.'
  Invoke-Adb @('emu','sms','send','+15551230001',$body)
  Write-Host 'Injected SYNTHETIC bank-like SMS. Observe Chrome lab; no bank transfer occurred.'
 }
 'Otp' {
  if($Code -notmatch '^\d{6}$'){throw 'Enter the exact six-digit code displayed by the Chrome lab using -Code 123456'}
  if($Domain -notmatch '^[a-zA-Z0-9.-]+$'){throw 'Invalid domain'}
  # WebOTP expects an origin-bound last line. This is a synthetic test SMS.
  $body="DISHA SMS transport experiment only. Code: $Code" + "`n" + "@$Domain #$Code"
  Invoke-Adb @('emu','sms','send','+15551230002',$body)
  Write-Host 'Injected synthetic origin-bound WebOTP SMS. Accept OS prompt if shown.'
 }
}
