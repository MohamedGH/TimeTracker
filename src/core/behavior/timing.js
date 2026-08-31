/**
 * Generic throttling helper. Not currently used for pointer movement (the
 * tracker intentionally never listens to mousemove — see
 * behavior-tracker.js), but kept available for any future high-frequency
 * signal (e.g. scroll position) that should be sampled rather than
 * observed on every browser event.
 */
export function throttle(fn, waitMs) {
  let last = 0;
  let pendingArgs = null;
  let timer = null;

  return function throttled(...args) {
    const now = Date.now();
    const remaining = waitMs - (now - last);
    if (remaining <= 0) {
      last = now;
      fn.apply(this, args);
    } else {
      pendingArgs = args;
      if (!timer) {
        timer = setTimeout(() => {
          last = Date.now();
          timer = null;
          if (pendingArgs) fn.apply(this, pendingArgs);
          pendingArgs = null;
        }, remaining);
      }
    }
  };
}
