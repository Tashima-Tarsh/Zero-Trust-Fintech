[CmdletBinding()]
param(
    [ValidateSet('Setup','Start','Import','Status')]
    [string]$Action = 'Status',
    [string]$RuntimeRoot = '',
    [switch]$NoBrowser
)
$ErrorActionPreference = 'Stop'
$engine = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
if (-not $RuntimeRoot) {
    $RuntimeRoot = Join-Path ([IO.Path]::GetPathRoot($engine)) 'FintechRuntime/n8n'
}
$runtime = [IO.Path]::GetFullPath($RuntimeRoot)
$packages = Join-Path $runtime 'packages'
$state = Join-Path $runtime 'state'
$cli = Join-Path $packages 'node_modules/n8n/bin/n8n'
$url = 'http://127.0.0.1:5678'

function Test-N8nReady {
    try {
        $response = Invoke-WebRequest "$url/healthz/readiness" -UseBasicParsing -TimeoutSec 3
        return $response.StatusCode -eq 200
    } catch { return $false }
}
function Set-N8nEnvironment {
    # A dedicated SQLite database for the editor; the payment worker still uses PostgreSQL.
    $env:N8N_USER_FOLDER = $state
    $env:DB_TYPE = 'sqlite'
    $env:N8N_LISTEN_ADDRESS = '127.0.0.1'
    $env:N8N_HOST = '127.0.0.1'
    $env:N8N_PORT = '5678'
    $env:N8N_PROTOCOL = 'http'
    $env:N8N_EDITOR_BASE_URL = $url
    $env:WEBHOOK_URL = "$url/"
    $env:GENERIC_TIMEZONE = 'Asia/Kolkata'
    $env:TZ = 'Asia/Kolkata'
}
function Invoke-N8n([string[]]$CliArguments) {
    & node $cli @CliArguments
    if ($LASTEXITCODE -ne 0) { throw "n8n command failed (exit $LASTEXITCODE)." }
}

if ($Action -eq 'Status') {
    [pscustomobject]@{
        EditorUrl = $url
        Installed = Test-Path -LiteralPath $cli
        Ready = Test-N8nReady
        RuntimeFolder = $runtime
        WorkerReady = $(try {
            (Invoke-WebRequest 'http://127.0.0.1:8000/health' -UseBasicParsing -TimeoutSec 3).StatusCode -eq 200
        } catch { $false })
        Workflows = (Get-ChildItem (Join-Path $engine 'n8n-workflows') -Filter '*.json').Count
    } | Format-List
    exit 0
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Install Node.js 22 or 24 first.' }
$nodeMajor = [int]((& node -p 'process.versions.node.split(".")[0]') | Select-Object -Last 1)
if ($nodeMajor -notin 22,24) { throw 'This setup requires Node.js 22 or 24.' }
New-Item -ItemType Directory -Path $packages,$state -Force | Out-Null
Set-N8nEnvironment

if ($Action -eq 'Setup' -and -not (Test-Path -LiteralPath $cli)) {
    if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) { throw 'npm.cmd is unavailable.' }
    # Keep the existing native-host workflows on n8n 2, rather than a future major upgrade.
    & npm.cmd install --prefix $packages --cache (Join-Path $runtime 'npm-cache') --save-exact --no-audit --no-fund n8n@2
    if ($LASTEXITCODE -ne 0) { throw 'n8n installation failed. Check network access and the npm output above.' }
}
if (-not (Test-Path -LiteralPath $cli)) { throw 'n8n is not installed. Run this script with -Action Setup.' }

if ($Action -in 'Setup','Import') {
    if (Test-N8nReady) {
        if ($Action -eq 'Import') { throw 'Stop n8n before importing workflows through the server CLI.' }
        Write-Host 'n8n is already running; skipping the offline import.'
    } else {
        $imports = Join-Path $runtime 'imports'
        New-Item -ItemType Directory -Path $imports -Force | Out-Null
        $marker = Join-Path $runtime 'imported-workflows.json'
        $known = @()
        if (Test-Path -LiteralPath $marker) { $known = @(Get-Content $marker -Raw | ConvertFrom-Json) }
        foreach ($file in Get-ChildItem (Join-Path $engine 'n8n-workflows') -Filter '*.json' | Sort-Object Name) {
            if ($file.Name -in $known) { continue }
            $workflow = Get-Content $file.FullName -Raw | ConvertFrom-Json
            $workflow | Add-Member -NotePropertyName active -NotePropertyValue $false -Force
            $workflow | Add-Member -NotePropertyName id -NotePropertyValue ([guid]::NewGuid().ToString('N').Substring(0,16)) -Force
            $importFile = Join-Path $imports $file.Name
            [IO.File]::WriteAllText($importFile,($workflow | ConvertTo-Json -Depth 100),(New-Object Text.UTF8Encoding $false))
            Invoke-N8n -CliArguments @('import:workflow',"--input=$importFile")
            $known += $file.Name
            [IO.File]::WriteAllText($marker,(ConvertTo-Json -InputObject @($known)),(New-Object Text.UTF8Encoding $false))
        }
        Write-Host 'Workflow import completed. Existing source JSON files were preserved. Workflows remain unpublished.'
    }
    if ($Action -eq 'Import') { exit 0 }
}

if (-not (Test-N8nReady)) {
    $listener = Get-NetTCPConnection -LocalPort 5678 -State Listen -ErrorAction SilentlyContinue
    if ($listener) { throw 'Port 5678 is occupied by a service that failed the n8n readiness check.' }
    $node = (Get-Command node).Source
    $log = Join-Path $runtime 'n8n.log'
    $errLog = Join-Path $runtime 'n8n-error.log'
    $process = Start-Process -FilePath $node -ArgumentList @(('"' + $cli + '"'),'start') -WindowStyle Hidden -PassThru -RedirectStandardOutput $log -RedirectStandardError $errLog
    $process.Id | Set-Content (Join-Path $runtime 'n8n.pid')
    $ready = $false
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
        if (Test-N8nReady) { $ready = $true; break }
        $process.Refresh()
        if ($process.HasExited) { throw "n8n exited. Inspect $errLog and $log" }
        Start-Sleep -Seconds 2
    }
    if (-not $ready) { throw "n8n did not become ready. Inspect $errLog and $log" }
}
Write-Host "n8n readiness verified: $url"
Write-Host 'Complete the local owner-account setup in the browser, then configure worker/webhook and PostgreSQL credentials in n8n.'
if (-not $NoBrowser) { Start-Process $url }

