import "server-only";

const shared = globalThis as typeof globalThis & {
  openPondWorkRuns?: Map<string, { userId: string; controller: AbortController }>;
};
const runs = shared.openPondWorkRuns ??= new Map();

export function registerWorkRun(userId: string, conversationId: string, controller: AbortController) {
  runs.set(conversationId, { userId, controller });
  return () => {
    if (runs.get(conversationId)?.controller === controller) runs.delete(conversationId);
  };
}

export function cancelWorkRun(userId: string, conversationId: string): boolean {
  const run = runs.get(conversationId);
  if (!run || run.userId !== userId) return false;
  run.controller.abort(new Error("Work canceled. Saved outputs are retained."));
  return true;
}
