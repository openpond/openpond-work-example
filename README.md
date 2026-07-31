# OpenPond Work example

A standalone Next.js application that demonstrates `@openpond/sdk` in a real server application. It provides the focused Work experience from OpenPond Sandbox: email/password authentication, a conversation sidebar, a centered work composer, a persistent transcript, and live sandbox/model/command progress.

OpenPond is an open-source agent orchestration system for doing durable work with any model, provider, or subscription. The SDK creates an isolated sandbox, asks OpenPond Chat to plan the work, executes model tool calls in that sandbox, and returns a sandbox ID that the next conversation turn can resume.

## What this proves

- `@openpond/sdk` installs into an independent Next.js project.
- The OpenPond API key only runs in Node route handlers and is never sent to the browser.
- Each conversation keeps its sandbox, filesystem, and transcript across turns.
- Deleting a conversation also requests deletion of its sandbox.
- Work progress streams to the UI as newline-delimited JSON.
- Better Auth provides open-source email/password authentication backed by local SQLite.

## Prerequisites

- Node.js 22.14 or newer (Node 24 is recommended)
- pnpm 11
- An OpenPond API key with sandbox and OpChat permissions
- For staging behind Vercel protection, its automation bypass secret

## Local setup

If this machine already has a staging account in `~/.openpond/config.json` and the sibling Sandbox Vercel project is linked, generate `.env.local` without printing its secrets:

```bash
pnpm setup:staging
```

Otherwise start from the template:

```bash
cp .env.example .env.local
```

Set the server-only values in `.env.local`:

```dotenv
OPENPOND_API_KEY=opk_...
OPENPOND_API_URL=https://staging-api.openpond.ai
VERCEL_AUTOMATION_BYPASS_SECRET=...
BETTER_AUTH_SECRET=generate-a-random-secret-at-least-32-characters-long
BETTER_AUTH_URL=http://localhost:3000
```

Then install, initialize Better Auth's SQLite tables, and run the app:

```bash
pnpm install
pnpm auth:migrate
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000), create an account, and enter a task. A repository URL is optional; leave it blank for an empty workspace.

Application data is written to `.data/openpond-work.sqlite` and is ignored by git. Set `OPENPOND_WORK_DATABASE` to use another SQLite file.

## SDK dependency during development

This proof project initially points to the sibling OpenPond checkout:

```json
"@openpond/sdk": "file:vendor/openpond-sdk-0.0.1.tgz"
```

That installs the exact tarball shape npm will distribute, not OpenPond desktop code. Rebuild it after SDK source changes:

```bash
cd ../openpond
pnpm build:sdk
npm pack ./packages/sdk --pack-destination ../openpond-work-example/vendor
cd ../openpond-work-example
pnpm install
```

After `@openpond/sdk@0.0.1` is bootstrapped on npm, replace the local dependency:

```bash
pnpm add @openpond/sdk@^0.0.1
```

## Architecture

The home page requires a Better Auth session. Conversation and message rows are scoped to the authenticated user in SQLite. `POST /api/conversations/:id/run` starts `openpond.work.run`, streams SDK events, stores the completed assistant message, and records the reusable sandbox ID.

The browser never imports an SDK runtime or receives credentials. `lib/openpond.ts` is marked `server-only`, and the work route explicitly uses the Node.js runtime.

## Validation

```bash
pnpm typecheck
pnpm build
```

For a live staging check, create a disposable user, run a simple task such as “Create `hello.txt` containing `sdk staging works`, then read it back,” send a second turn asking it to read the same file, and delete the conversation when finished.

## Deployment notes

SQLite is ideal for this local proof. A multi-instance or serverless deployment should replace the conversation database with a durable hosted SQL database supported by Better Auth. The SDK and route handler do not otherwise depend on local state; the sandbox itself remains hosted by OpenPond.

Configure `OPENPOND_API_KEY`, `OPENPOND_API_URL`, `BETTER_AUTH_SECRET`, and `BETTER_AUTH_URL` as server-side deployment secrets. Never prefix the OpenPond key with `NEXT_PUBLIC_`.
