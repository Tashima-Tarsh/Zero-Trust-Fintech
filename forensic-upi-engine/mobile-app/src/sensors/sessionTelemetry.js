// Opt-in, minimal aggregate telemetry; no raw touch paths, gyro traces or fingerprints.
export function createSessionTelemetry(consented = false) {
  const started = Date.now();
  let touches = 0;
  return {
    recordTouch() { if (consented) touches += 1; },
    snapshot() {
      if (!consented) return null;
      return { elapsed_ms: Math.max(0, Date.now() - started), touch_count: touches };
    }
  };
}
