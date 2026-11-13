import { AppState } from 'react-native';

/**
 * Low-confidence elapsed time spent away from this application.
 * State transitions may be missed; never a payment success indicator.
 */
export function createAppStateTracker(onReturn, consented = false) {
  if (!consented) return () => {};
  let backgroundAt = null;
  const sub = AppState.addEventListener('change', next => {
    if (next !== 'active' && backgroundAt === null) backgroundAt = Date.now();
    if (next === 'active' && backgroundAt !== null) {
      const elapsed = Math.max(0, Date.now() - backgroundAt);
      backgroundAt = null;
      onReturn({ elapsed_ms: elapsed, can_confirm_payment: false });
    }
  });
  return () => sub.remove();
}
