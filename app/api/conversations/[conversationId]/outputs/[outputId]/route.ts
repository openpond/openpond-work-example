import { createHash } from "node:crypto";

import { getConversationOutput } from "@/lib/conversations";
import { requireApiSession } from "@/lib/session";
import { workOutputStore } from "@/lib/work-output-store";

export const runtime = "nodejs";

type Context = {
  params: Promise<{ conversationId: string; outputId: string }>;
};

export async function GET(_request: Request, context: Context) {
  const session = await requireApiSession();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { conversationId, outputId } = await context.params;
  const output = getConversationOutput(session.user.id, conversationId, outputId);
  if (!output) return Response.json({ error: "Output not found" }, { status: 404 });

  const bytes = await workOutputStore().get(output.storageKey).catch(() => null);
  if (!bytes) {
    return Response.json({ error: "Stored output is unavailable" }, { status: 503 });
  }
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (bytes.byteLength !== output.sizeBytes || sha256 !== output.sha256) {
    return Response.json({ error: "Stored output failed verification" }, { status: 409 });
  }

  return new Response(Buffer.from(bytes), {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(output.name)}`,
      "Content-Length": String(bytes.byteLength),
      "Content-Type": output.mimeType,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
