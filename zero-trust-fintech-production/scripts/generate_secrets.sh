#!/bin/bash

# =============================================================================
# Generate Cryptographically Secure Secrets for Zero-Trust Production Deployments
# =============================================================================

set -e

echo "🔐 Generating secure production secrets..."

# Generate JWT secret (64 characters hex = 256 bits of entropy)
JWT_SECRET=$(openssl rand -hex 32)
echo "JWT_SECRET_KEY=$JWT_SECRET"

# Generate n8n API key
N8N_API_KEY=$(openssl rand -hex 32)
echo "N8N_API_KEY=$N8N_API_KEY"

# Generate Database password
DB_PASSWORD=$(openssl rand -base64 32 | tr -d '=+/' | cut -c1-32)
echo "DB_PASSWORD=$DB_PASSWORD"

echo ""
echo "✅ Secrets generated. Copy these to your production .env file or secret manager."
echo ""
echo "⚠️  IMPORTANT: Store these securely!"
echo "   - Use AWS Secrets Manager, GCP Secret Manager, Azure Key Vault, or HashiCorp Vault"
echo "   - Never commit .env files to source control"
echo "   - Rotate keys and credentials periodically"
