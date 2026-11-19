# Installs pinned upstream agent prompt skills, no remote scripts executed.
# Project-scoped skills work with compatible agent hosts; global copy supports Antigravity.
param([string]$ProjectRoot = (Join-Path $PSScriptRoot '..'), [switch]$ProjectOnly)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path -LiteralPath $ProjectRoot).Path
$projectSkills = Join-Path $root '.agents\skills'
$targets = @($projectSkills)
if (-not $ProjectOnly) {
    $targets += (Join-Path $HOME '.gemini\antigravity\skills')
}
$sources = @(
    @{ Name='ponytail'; Repo='DietrichGebert/ponytail'; Commit='96608e078b2d5ea607c5c3b8b5a54d1c1fba6846'; Path='skills/ponytail/SKILL.md' },
    @{ Name='android-intent-security'; Repo='android/skills'; Commit='c72942584fff970dac86ced78b367fce0c441e52'; Path='security/android-intent-security/SKILL.md' },
    @{ Name='testing-setup'; Repo='android/skills'; Commit='c72942584fff970dac86ced78b367fce0c441e52'; Path='testing/testing-setup/SKILL.md' },
    @{ Name='android-cli'; Repo='android/skills'; Commit='c72942584fff970dac86ced78b367fce0c441e52'; Path='devtools/android-cli/SKILL.md' }
)
foreach ($source in $sources) {
    $uri = "https://raw.githubusercontent.com/$($source.Repo)/$($source.Commit)/$($source.Path)"
    foreach ($destination in $targets) {
        $dir = Join-Path $destination $source.Name
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
        $file = Join-Path $dir 'SKILL.md'
        $temp = "$file.download"
        try {
            Invoke-WebRequest -Uri $uri -OutFile $temp -UseBasicParsing
            $content = Get-Content -LiteralPath $temp -Raw
            if (-not $content.StartsWith('---') -or $content.Length -lt 200 -or $content -notmatch '(?m)^name:') {
                throw "Unexpected skill content from $uri"
            }
            Move-Item -LiteralPath $temp -Destination $file -Force
        } finally {
            if (Test-Path -LiteralPath $temp) { Remove-Item -LiteralPath $temp -Force }
        }
        Write-Host "INSTALLED $($source.Name) -> $file"
    }
}
$local = Join-Path $projectSkills 'disha-android-debugging\SKILL.md'
if (-not (Test-Path -LiteralPath $local)) { throw "Project debugging skill missing: $local" }
if (-not $ProjectOnly) {
    $dir = Join-Path $HOME '.gemini\antigravity\skills\disha-android-debugging'
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
    Copy-Item -LiteralPath $local -Destination (Join-Path $dir 'SKILL.md') -Force
    Write-Host "INSTALLED disha-android-debugging -> $dir"
}
Write-Host 'DONE: repo and Antigravity prompt skills installed. Restart the IDE agent session to load them.'
