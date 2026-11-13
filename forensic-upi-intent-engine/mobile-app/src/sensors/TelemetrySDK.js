/**
 * Consent-aware, session-scoped *aggregate* timings, not device fingerprinting.
 * No gyro traces, location, persistent ID, contact lists, or raw touch coordinates.
 */
export function createTelemetrySDK({ consented = false } = {}) {
  const start = Date.now();
  let interactions = 0;
  return {
    recordInteraction() {
      if (consented) interactions++;
    },
    snapshot() {
      if (!consented) return null;
      return {
        elapsed_ms: Math.max(0, Date.now() - start),
        touch_count: interactions,
        can_confirm_payment: false
      };
    }
  };
}
