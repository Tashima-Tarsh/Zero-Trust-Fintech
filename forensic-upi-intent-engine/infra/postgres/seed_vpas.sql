-- These 1,000 addresses are SYNTHETIC and disabled. They cannot receive UPI payments.
-- Production onboarding requires the merchant's verified authorized VPA inventory.
INSERT INTO upi_vpa_pool(vpa_address,merchant_id,enabled,status,health_status)
SELECT 'sandbox' || lpad(g::text, 4, '0') || '@demo', 'demo', FALSE, 'available', 'unknown'
FROM generate_series(1,1000) AS g
ON CONFLICT (vpa_address) DO NOTHING;
