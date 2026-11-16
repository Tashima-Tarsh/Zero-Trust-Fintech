# Example PowerShell script to export API tokens for MCP and CLI integration
# Copy this file to scripts/set-tokens.local.ps1 (gitignored) and fill in your keys.

$env:GITHUB_TOKEN     = "ghp_your_github_token"
$env:RAILWAY_TOKEN    = "railway_your_token"
$env:CLERK_TOKEN      = "clrk_your_clerk_token"
$env:CLOUDFLARE_TOKEN = "cf_your_cloudflare_token"
$env:RESEND_TOKEN     = "re_your_resend_token"
$env:N8N_TOKEN        = "n8n_your_token"

Write-Host "✅ Environment tokens loaded successfully for this session." -ForegroundColor Green
