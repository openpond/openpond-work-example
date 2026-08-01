# OpenPond Work example

A standalone Next.js application that demonstrates `openpond-sdk` in a real server application. It provides the focused Work experience from OpenPond Sandbox: email/password authentication, collapsible conversation and output sidebars, a centered work composer, a persistent transcript, and grouped live sandbox/model/command progress.

OpenPond is an open-source agent orchestration system for doing durable work with any model, provider, or subscription. The server-focused SDK creates isolated compute, asks OpenPond Chat to plan the work, executes tool calls, persists final outputs, and deletes ordinary Work sandboxes when the turn ends. Later turns start fresh compute and receive the latest saved output revisions as inputs.

## Prerequisites

- Node.js 22.14 or newer (Node 24 is recommended)
- pnpm 11
- An OpenPond API key with sandbox and OpChat permissions

## Local setup

Start from the environment template:

```bash
cp .env.example .env.local
```

Set the server-only values in `.env.local`:

```dotenv
OPENPOND_API_KEY=opk_...
OPENPOND_API_URL=https://api.openpond.ai
BETTER_AUTH_SECRET=generate-a-random-secret-at-least-32-characters-long
BETTER_AUTH_URL=http://localhost:3000
```

The SDK sends requests to `https://api.openpond.ai` by default. `OPENPOND_API_URL` allows a private local override without changing application code.

Then install, initialize Better Auth's SQLite tables, and run the app:

```bash
pnpm install
pnpm auth:migrate
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000), create an account, and enter a task.

Application data is written to `.data/openpond-work.sqlite`, while durable output bytes are written to `.data/work-outputs/`. Both are ignored by git. Set `OPENPOND_WORK_DATABASE` or `OPENPOND_WORK_OUTPUT_DIRECTORY` to use other server-side locations.

## SDK dependency

While the lifecycle changes are being validated together, this checkout links the sibling OpenPond SDK source:

```json
"openpond-sdk": "file:../openpond/packages/sdk"
```

After the next SDK patch is published, replace that development link with the public package. External applications install or update it independently of the OpenPond desktop application:

```bash
pnpm add openpond-sdk@latest
```

## Architecture

The home page requires a Better Auth session. Conversation, message, output-revision, and cleanup-outbox rows are scoped to the authenticated user in SQLite. `POST /api/conversations/:id/run` starts `openpond.work.run` with `cleanup: "delete"`, streams SDK events, and awaits an output-persistence callback before sandbox deletion begins.

Output downloads are served from the local output store, never from a live sandbox. If persistence fails, the sandbox is stopped and the cleanup outbox retries the copy before deletion. If deletion alone fails, the already-durable result remains downloadable while cleanup retries. A follow-up turn verifies and stages the latest revision of each saved output into a fresh sandbox.

The browser never imports an SDK runtime or receives credentials. `lib/openpond.ts` is marked `server-only`, and the work route explicitly uses the Node.js runtime.

## Validation

```bash
pnpm typecheck
pnpm build
```

For a live API check, create a disposable user, run a task such as “Create `hello.txt` containing `sdk works` as an output,” download it after the turn completes, then send a second turn asking OpenPond to revise the saved file. The second turn should use a new sandbox while still receiving the prior durable output.

## Deployment notes

SQLite and local output storage are ideal for this local proof. A multi-instance or serverless deployment must replace them with durable hosted SQL and object storage; a serverless instance filesystem is not a durable output store. The `WorkOutputStore` interface in `lib/work-output-store.ts` is the replacement boundary for S3, R2, Vercel Blob, or another object store.

Configure `OPENPOND_API_KEY`, `OPENPOND_API_URL`, `BETTER_AUTH_SECRET`, and `BETTER_AUTH_URL` as server-side deployment secrets. Never prefix the OpenPond key with `NEXT_PUBLIC_`.
