/** Error that carries every rejection reason, like AggregateError (not relied on in Hermes). */
export class AllFailedError extends Error {
  constructor(message: string, readonly reasons: unknown[]) {
    super(message);
    this.name = 'AllFailedError';
  }
}

/**
 * Resolves with the first promise that fulfils; rejects with AllFailedError
 * when all reject. Equivalent to Promise.any without depending on it.
 */
export function firstFulfilled<T>(promises: readonly Promise<T>[], message = 'all attempts failed'): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (promises.length === 0) {
      reject(new AllFailedError(message, []));
      return;
    }
    const reasons: unknown[] = new Array(promises.length);
    let pending = promises.length;
    promises.forEach((p, i) => {
      p.then(resolve, (err: unknown) => {
        reasons[i] = err;
        pending -= 1;
        if (pending === 0) reject(new AllFailedError(message, reasons));
      });
    });
  });
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
