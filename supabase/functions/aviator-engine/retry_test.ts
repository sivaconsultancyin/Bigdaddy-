import { assertEquals } from "jsr:@std/assert@1";
import { retryTimedOutTick, type TickRpcResult } from "./retry.ts";

Deno.test("retries SQLSTATE 57014 and succeeds without releasing the worker", async () => {
  let calls = 0;
  const waits: number[] = [];
  const result = await retryTimedOutTick(
    async (): Promise<TickRpcResult<{ action: string }>> => {
      calls += 1;
      if (calls < 3) return { data: null, error: { code: "57014" } };
      return { data: { action: "round_running" }, error: null };
    },
    async (ms) => { waits.push(ms); },
  );
  assertEquals(calls, 3);
  assertEquals(waits, [100, 250]);
  assertEquals(result.attempts, 3);
  assertEquals(result.retries, 2);
  assertEquals(result.result.data, { action: "round_running" });
});

Deno.test("does not retry non-timeout RPC errors", async () => {
  let calls = 0;
  const result = await retryTimedOutTick(async () => {
    calls += 1;
    return { data: null, error: { code: "42501" } };
  }, async () => { throw new Error("unexpected retry"); });
  assertEquals(calls, 1);
  assertEquals(result.retries, 0);
  assertEquals(result.result.error?.code, "42501");
});

Deno.test("bounds repeated timeout retries", async () => {
  let calls = 0;
  const result = await retryTimedOutTick(async () => {
    calls += 1;
    return { data: null, error: { code: "57014" } };
  }, async () => {}, [1, 2, 3]);
  assertEquals(calls, 4);
  assertEquals(result.attempts, 4);
  assertEquals(result.retries, 3);
  assertEquals(result.result.error?.code, "57014");
});
