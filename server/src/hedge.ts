// Tail-latency hedge for a single async operation.
//
// Gemini's per-call latency is bimodal — a ~1-3s common case with a heavy
// tail that spiked to 18-35s in production (2026-09-03), and those spikes are
// what made the voice UX unusable, not the median. If the primary call hasn't
// settled within `hedgeAfterMs`, we fire a SECOND identical call and take
// whichever SUCCEEDS first; a duplicate request almost never draws the same
// tail, so this collapses P90 back toward the median. The extra call happens
// ONLY on the slow fraction (a call that beats the threshold never triggers a
// hedge). `make` must be safe to invoke twice — the caller only ever passes
// the LLM round trip here, never anything that mutates state, so the losing
// call's result is simply discarded.
//
// Semantics: resolve on the first call that succeeds; reject only once every
// call launched has rejected and no further hedge will be launched. A primary
// rejection therefore does NOT abandon an in-flight hedge — the hedge is also
// a modest resilience win, not just a latency one.
export interface HedgeOptions {
  hedgeAfterMs: number;
  // Called just before a hedge would fire; return false to suppress it (e.g.
  // when too little turn budget remains for a second call to finish in time).
  shouldHedge?: () => boolean;
  // Fired when a hedge is actually launched — for logging/metrics.
  onHedge?: () => void;
}

export function hedgedCall<T>(make: () => Promise<T>, opts: HedgeOptions): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let inFlight = 0;
    let mayStillHedge = true; // a hedge could still be launched by the timer
    let settled = false;
    let lastError: unknown;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const succeed = (value: T) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    // Reject only when nothing is in flight and no more calls will start.
    const rejectIfExhausted = () => {
      if (!settled && inFlight === 0 && !mayStillHedge) {
        settled = true;
        reject(lastError);
      }
    };

    const launch = () => {
      inFlight++;
      make().then(
        (value) => {
          inFlight--;
          succeed(value);
        },
        (err) => {
          inFlight--;
          lastError = err;
          rejectIfExhausted();
        },
      );
    };

    launch(); // primary

    timer = setTimeout(() => {
      mayStillHedge = false;
      if (settled) return;
      if (!opts.shouldHedge || opts.shouldHedge()) {
        opts.onHedge?.();
        launch();
      } else {
        // No hedge is coming; if the primary already failed, reject now.
        rejectIfExhausted();
      }
    }, opts.hedgeAfterMs);
  });
}
