-- Synthetic, NON-TRANSACTABLE examples. Disabled by default.
-- Import your own approved VPAs and perform explicit health/merchant checks.
INSERT INTO vpa_pool(vpa, merchant_id, enabled, health_status)
SELECT 'sandbox' || lpad(n::text, 4, '0') || '@demo', 'demo', FALSE, 'unknown'
FROM generate_series(1, 1000) AS n
ON CONFLICT (vpa) DO NOTHING;
