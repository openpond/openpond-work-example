import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";

export type StoredWorkOutput = {
  storageKey: string;
  sha256: string;
  sizeBytes: number;
};

export interface WorkOutputStore {
  put(input: {
    ownerId: string;
    conversationId: string;
    outputId: string;
    name: string;
    mimeType: string;
    expectedSizeBytes: number;
    bytes: Uint8Array;
  }): Promise<StoredWorkOutput>;
  get(storageKey: string): Promise<Uint8Array>;
  delete(storageKey: string): Promise<void>;
}

class LocalWorkOutputStore implements WorkOutputStore {
  readonly #root: string;

  constructor(root: string) {
    this.#root = path.resolve(root);
  }

  async put(input: Parameters<WorkOutputStore["put"]>[0]): Promise<StoredWorkOutput> {
    if (input.bytes.byteLength !== input.expectedSizeBytes) {
      throw new Error(
        `Output size mismatch: expected ${input.expectedSizeBytes}, received ${input.bytes.byteLength}`,
      );
    }
    const storageKey = [
      safeSegment(input.ownerId),
      safeSegment(input.conversationId),
      `${safeSegment(input.outputId)}-${safeFilename(input.name)}`,
    ].join("/");
    const target = this.#resolve(storageKey);
    await mkdir(path.dirname(target), { recursive: true });
    const temporary = `${target}.${randomUUID()}.tmp`;
    try {
      const file = await open(temporary, "wx", 0o600);
      try { await file.writeFile(input.bytes); await file.sync(); }
      finally { await file.close(); }
      await rename(temporary, target);
      const directory = await open(path.dirname(target), "r");
      try { await directory.sync(); }
      finally { await directory.close(); }
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined);
    }
    return {
      storageKey,
      sha256: createHash("sha256").update(input.bytes).digest("hex"),
      sizeBytes: input.bytes.byteLength,
    };
  }

  async get(storageKey: string): Promise<Uint8Array> {
    return readFile(this.#resolve(storageKey));
  }

  async delete(storageKey: string): Promise<void> {
    await rm(this.#resolve(storageKey), { force: true });
  }

  #resolve(storageKey: string): string {
    const target = path.resolve(this.#root, storageKey);
    const relative = path.relative(this.#root, target);
    if (
      !relative ||
      relative === ".." ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    ) {
      throw new Error("Invalid Work output storage key");
    }
    return target;
  }
}

const globalOutputStore = globalThis as typeof globalThis & {
  openPondWorkOutputStore?: WorkOutputStore;
};

export function workOutputStore(): WorkOutputStore {
  if (globalOutputStore.openPondWorkOutputStore) {
    return globalOutputStore.openPondWorkOutputStore;
  }
  const root = process.env.OPENPOND_WORK_OUTPUT_DIRECTORY?.trim()
    ? path.resolve(process.env.OPENPOND_WORK_OUTPUT_DIRECTORY)
    : path.join(process.cwd(), ".data", "work-outputs");
  const store = new LocalWorkOutputStore(root);
  if (process.env.NODE_ENV !== "production") {
    globalOutputStore.openPondWorkOutputStore = store;
  }
  return store;
}

function safeSegment(value: string): string {
  const safe = value.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 120);
  if (!safe || safe === "." || safe === "..") {
    throw new Error("Invalid Work output identifier");
  }
  return safe;
}

function safeFilename(value: string): string {
  const name = path.basename(value).replace(/[^a-zA-Z0-9._-]+/g, "-");
  return name.slice(-160) || "output";
}
