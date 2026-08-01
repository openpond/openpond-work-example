import "server-only";

import {
  completeSandboxCleanup,
  finalizeConversationOutput,
  listPendingConversationOutputsForSandbox,
  listPendingSandboxCleanups,
  retrySandboxCleanup,
} from "@/lib/conversations";
import { openPondClient } from "@/lib/openpond";
import { workOutputStore } from "@/lib/work-output-store";

let activeRetry: Promise<void> | null = null;

export function retryPendingSandboxCleanups(): Promise<void> {
  activeRetry ??= runPendingSandboxCleanups().finally(() => {
    activeRetry = null;
  });
  return activeRetry;
}

async function runPendingSandboxCleanups(): Promise<void> {
  for (const cleanup of listPendingSandboxCleanups()) {
    try {
      const pendingOutputs = listPendingConversationOutputsForSandbox(
        cleanup.sandboxId,
      );
      if (pendingOutputs.length > 0) {
        const sandbox = await openPondClient().sandboxes.get(cleanup.sandboxId);
        if (sandbox.state === "stopped") {
          await openPondClient().sandboxes.start(cleanup.sandboxId);
        }
        for (const output of pendingOutputs) {
          const response = await openPondClient().sandboxes.downloadFileResponse(
            cleanup.sandboxId,
            { path: output.path, maxBytes: Math.max(1, output.sizeBytes) },
          );
          if (
            response.file.truncated ||
            response.file.returnedBytes !== response.file.totalSizeBytes
          ) {
            throw new Error(`Output recovery was incomplete for ${output.name}`);
          }
          const bytes = Buffer.from(response.file.contentsBase64, "base64");
          const stored = await workOutputStore().put({
            ownerId: output.userId,
            conversationId: output.conversationId,
            outputId: output.id,
            name: output.name,
            mimeType: output.mimeType,
            expectedSizeBytes: output.sizeBytes,
            bytes,
          });
          finalizeConversationOutput(
            output.userId,
            output.conversationId,
            output.id,
            stored,
          );
        }
      }
      await openPondClient().work.deleteSandbox(cleanup.sandboxId);
      completeSandboxCleanup(cleanup.sandboxId);
    } catch (error) {
      retrySandboxCleanup(
        cleanup.sandboxId,
        cleanup.attempts,
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}
