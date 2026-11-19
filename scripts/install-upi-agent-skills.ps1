# Installs complete, commit-pinned upstream agent skills; never executes downloaded code.
# Installs project skills and (by default) Antigravity user skills.
param([string]$ProjectRoot = (Join-Path $PSScriptRoot '..'), [switch]$ProjectOnly)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path -LiteralPath $ProjectRoot).Path
$projectSkills = Join-Path $root '.agents\skills'
$targets = @($projectSkills)
if (-not $ProjectOnly) { $targets += (Join-Path $HOME '.gemini\antigravity\skills') }

$repos = @(
    @{ Name='DietrichGebert/ponytail'; Sha='96608e078b2d5ea607c5c3b8b5a54d1c1fba6846'; Skills=@(
        @{ Name='ponytail'; Folder='skills/ponytail' }
    ) },
    @{ Name='android/skills'; Sha='c72942584fff970dac86ced78b367fce0c441e52'; Skills=@(
        @{ Name='android-intent-security'; Folder='security/android-intent-security' },
        @{ Name='testing-setup'; Folder='testing/testing-setup' },
        @{ Name='android-cli'; Folder='devtools/android-cli' }
    ) }
)
$tempRoot = Join-Path ([IO.Path]::GetTempPath()) ('disha-skills-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null
try {
    foreach ($repo in $repos) {
        $short = ($repo.Name -split '/')[1]
        $zip = Join-Path $tempRoot ($short + '.zip')
        $unpack = Join-Path $tempRoot $short
        $uri = "https://codeload.github.com/$($repo.Name)/zip/$($repo.Sha)"
        Invoke-WebRequest -Uri $uri -OutFile $zip -UseBasicParsing
        Expand-Archive -LiteralPath $zip -DestinationPath $unpack -Force
        $sourceRoot = (Get-ChildItem -LiteralPath $unpack -Directory | Select-Object -First 1).FullName
        if (-not $sourceRoot) { throw "Invalid upstream archive: $($repo.Name)" }
        foreach ($skill in $repo.Skills) {
            $source = Join-Path $sourceRoot ($skill.Folder -replace '/', '\')
            if (-not (Test-Path -LiteralPath (Join-Path $source 'SKILL.md'))) {
                throw "Missing upstream SKILL.md: $($skill.Name)"
            }
            foreach ($target in $targets) {
                $dest = Join-Path $target $skill.Name
                New-Item -ItemType Directory -Path $dest -Force | Out-Null
                Copy-Item -Path (Join-Path $source '*') -Destination $dest -Recurse -Force
                if (-not (Test-Path -LiteralPath (Join-Path $dest 'SKILL.md'))) {
                    throw "Skill installation verification failed: $dest"
                }
                Write-Host "INSTALLED $($skill.Name) -> $dest"
            }
        }
    }
    $local = Join-Path $projectSkills 'disha-android-debugging\SKILL.md'
    if (-not (Test-Path -LiteralPath $local)) { throw "Missing DISHA project skill: $local" }
    if (-not $ProjectOnly) {
        $dest = Join-Path $HOME '.gemini\antigravity\skills\disha-android-debugging'
        New-Item -ItemType Directory -Path $dest -Force | Out-Null
        Copy-Item -LiteralPath $local -Destination (Join-Path $dest 'SKILL.md') -Force
        Write-Host "INSTALLED disha-android-debugging -> $dest"
    }
} finally {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
}
Write-Host 'DONE: Complete upstream skill directories installed. Restart the coding agent session.'
