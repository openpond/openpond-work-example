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

This acceptance checkout uses a self-contained SDK archive, with its source commit
and SHA-256 recorded in `vendor/sdk-receipt.json`:

```json
"openpond-sdk": "file:vendor/openpond-sdk-0.6.2-ea8d1f55.tgz"
```

The archive is an acceptance candidate, not a new public npm release. After the
verified SDK patch is published, pin that exact version. External applications
install it independently of the OpenPond desktop application:

```bash
pnpm add openpond-sdk@latest
```

## Architecture

The home page requires a Better Auth session. Conversation, message, output-revision, and cleanup-outbox rows are scoped to the authenticated user in SQLite. `POST /api/conversations/:id/run` starts `openpond.work.run` with `cleanup: "delete"`, streams SDK events, and awaits an output-persistence callback before sandbox deletion begins.

Output downloads are served from the local output store, never from a live sandbox. If persistence fails, a customer runtime guest stays running so the cleanup outbox can retry the copy before deletion. Hosted guests can be stopped and resumed for recovery. If deletion alone fails, the already-durable result remains downloadable while cleanup retries. A follow-up turn verifies and stages the latest revision of each saved output into a fresh sandbox.

The browser never imports an SDK runtime or receives credentials. `lib/openpond.ts` is marked `server-only`, and the work route explicitly uses the Node.js runtime.

## Validation

```bash
pnpm typecheck
pnpm build
node --conditions=react-server --import tsx --test lib/recovery.test.ts
```

For a live API check, create a disposable user, run a task such as “Create `hello.txt` containing `sdk works` as an output,” download it after the turn completes, then send a second turn asking OpenPond to revise the saved file. The second turn should use a new sandbox while still receiving the prior durable output.

## Deployment notes

SQLite and local output storage are ideal for this local proof. A multi-instance or serverless deployment must replace them with durable hosted SQL and object storage; a serverless instance filesystem is not a durable output store. The `WorkOutputStore` interface in `lib/work-output-store.ts` is the replacement boundary for S3, R2, Vercel Blob, or another object store.

Configure `OPENPOND_API_KEY`, `OPENPOND_API_URL`, `BETTER_AUTH_SECRET`, and `BETTER_AUTH_URL` as server-side deployment secrets. Never prefix the OpenPond key with `NEXT_PUBLIC_`.

## Customer AWS installation

Run one application process outside the sandbox guests. Mount a durable encrypted
volume at `/data`, with `OPENPOND_WORK_DATABASE=/data/work.sqlite` and
`OPENPOND_WORK_OUTPUT_DIRECTORY=/data/outputs`. Give the container's Node user
(UID 1000) ownership. The Docker entrypoint initializes the authentication schema
before starting the app. Use an HTTPS origin for customer browser access; an SSM
tunnel and a matching localhost `BETTER_AUTH_URL` are sufficient for acceptance.

Set `OPENPOND_SANDBOX_ENDPOINT` to the private runtime endpoint and
`OPENPOND_SANDBOX_API_KEY` to its separate runtime credential. Keep the hosted model
by retaining the existing OpenPond API key and URL. For a customer-selected model,
set all three of `OPENPOND_MODEL_ENDPOINT`, `OPENPOND_MODEL_API_KEY`, and
`OPENPOND_MODEL_ID`. The model endpoint is a Chat Completions base URL. Credentials
stay in the application server and are never injected into guests.

Cancel aborts the current Work request and begins cleanup. An application restart
marks interrupted runs failed, retains saved history and files, and reconciles
known guests and pending allocations. It never automatically replays tool side
effects. Submit another turn to continue from durable history and outputs.

Before backup or upgrade, stop admitting new requests and wait for active Work and
cleanup to finish, then stop the app. Back up the complete data volume, including
the SQLite database, WAL and outputs, as one consistent snapshot. Restore into a
separate volume before switching traffic. Keep the previous application image
digest and snapshot for rollback; never run two app processes against this store.
Retained backups contain customer data and authentication state and need the same
encryption and access controls as the original volume.

For the documented `/data/work.sqlite` layout, after draining and stopping the app:

```bash
node scripts/data-snapshot.mjs backup /data /backups/work-2026-09-15
node scripts/data-snapshot.mjs restore /backups/work-2026-09-15 /data-restored
```

The backup command refuses outstanding Work/cleanup, locks database writers while
copying, and records file hashes. Restore verifies those hashes and SQLite
integrity and requires a new target directory. Mount the restored directory in
the app, verify login/history/downloads, then switch traffic. Keep the original
volume until restore acceptance succeeds.
