import assert from "node:assert/strict";
import { test } from "node:test";
import { cancelWorkRun, registerWorkRun } from "./work-runs";

test("cancellation stays owner scoped and stale cleanup cannot remove a new run", () => {
  const first = new AbortController();
  const unregisterFirst = registerWorkRun("owner", "conversation", first);
  assert.equal(cancelWorkRun("other-owner", "conversation"), false);
  assert.equal(first.signal.aborted, false);
  assert.equal(cancelWorkRun("owner", "conversation"), true);
  assert.equal(first.signal.aborted, true);
  const second = new AbortController();
  const unregisterSecond = registerWorkRun("owner", "conversation", second);
  unregisterFirst();
  assert.equal(cancelWorkRun("owner", "conversation"), true);
  assert.equal(second.signal.aborted, true);
  unregisterSecond();
  assert.equal(cancelWorkRun("owner", "conversation"), false);
});
