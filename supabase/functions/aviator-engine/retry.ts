export type TickRpcError = { code?: string };
export type TickRpcResult<T> = { data: T | null; error: TickRpcError | null };

export interface TickRetryResult<T> {
  result: TickRpcResult<T>;
  attempts: number;
  retries: number;
}

const DEFAULT_RETRY_DELAYS_MS = [100, 250, 500] as const;

/**
 * PostgreSQL SQLSTATE 57014 means the statement was cancelled (in this case by
 * statement_timeout). The RPC transaction is rolled back, so retrying this
 * specific failure is safe. Other errors are returned immediately.
 */
export async function retryTimedOutTick<T>(
  tick: () => PromiseLike<TickRpcResult<T>>,
  wait: (milliseconds: number) => Promise<void> = (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds)),
  retryDelaysMs: readonly number[] = DEFAULT_RETRY_DELAYS_MS,
): Promise<TickRetryResult<T>> {
  let attempts = 0;
  while (true) {
    attempts += 1;
    const result = await tick();
    if (!result.error || result.error.code !== "57014" || attempts > retryDelaysMs.length) {
      return { result, attempts, retries: attempts - 1 };
    }
    await wait(retryDelaysMs[attempts - 1]);
  }
}
