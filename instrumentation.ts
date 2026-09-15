export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NEXT_PHASE === "phase-production-build") return;
  const { recoverInterruptedRuns } = await import("./lib/conversations");
  const { retryPendingSandboxCleanups } = await import("./lib/sandbox-cleanup");
  recoverInterruptedRuns();
  const timer = setInterval(() => {
    void retryPendingSandboxCleanups().catch(() => console.error("Work cleanup reconciliation failed"));
  }, 5000);
  timer.unref();
}
