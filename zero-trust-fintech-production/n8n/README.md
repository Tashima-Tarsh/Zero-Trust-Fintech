# n8n Workflows

Orchestration workflows for automated payment verification, settlement, and fraud alerting.

## Directory Structure
```
n8n/workflows/
├── production/          # Production workflows
│   ├── payment_verification.json
│   └── fraud_alert.json
├── staging/             # Staging workflows
└── development/         # Development workflows
```

## Deployment & Import
Import workflows into the running n8n instance via curl or the n8n UI:
```bash
# Import payment verification workflow
curl -X POST http://localhost:5678/api/v1/workflows \
  -H "Content-Type: application/json" \
  -H "X-N8N-API-KEY: $N8N_API_KEY" \
  -d @n8n/workflows/production/payment_verification.json

# Import fraud alert workflow
curl -X POST http://localhost:5678/api/v1/workflows \
  -H "Content-Type: application/json" \
  -H "X-N8N-API-KEY: $N8N_API_KEY" \
  -d @n8n/workflows/production/fraud_alert.json
```

## Environment Variables
- `BANK_SETTLEMENT_API`: Direct Bank / PSP settlement API endpoint
- `BANK_API_KEY`: Bank API authentication Bearer token
- `SLACK_WEBHOOK_URL`: Slack webhook URL for real-time security alerts
- `N8N_WEBHOOK_URL`: Base URL for n8n webhooks
