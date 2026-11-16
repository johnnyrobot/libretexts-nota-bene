# Native NB local baseline

This fork runs NB's own service, course model and annotation client. Server ancestry starts at `haystack/nb` commit `ce4ef480e6ec3181711ae7f456f8e4f975438bcc`. The paired client is `johnnyrobot/libretexts-nota-bene-client`, descended from `haystack/nbclient` commit `24f988ed17f3d26ea13c15b26b80ca80d01e4ed6`. Record both fork commits when handing off a build.

This procedure is for synthetic local development. It does not establish institutional production readiness, authorization security, accessibility conformance, grant compliance or identity with an unpublished NB release. Upstream notices and rights remain separate; no MIT relicensing of NB is implied.

## Requirements

The verified environment is macOS arm64, Node 22.23.4, npm 10.9.9, PostgreSQL 16 and OpenSSL. Use matching Node tooling for both repositories. Set `NB_BASELINE_PG_BIN` to the directory containing `initdb`, `pg_ctl` and `createdb`. Do not start a global PostgreSQL service or point this procedure at another database.

On a Mac without PostgreSQL, a keg-only installation can be prepared without linking executables or creating the default cluster:

```sh
brew install --skip-post-install --skip-link postgresql@16
export NB_BASELINE_PG_BIN=/opt/homebrew/opt/postgresql@16/bin
```

Podman is optional. A local-machine start in the initial verification reported success but stopped before accepting connections; the verified run used native PostgreSQL instead. No container settings or default connections were changed.

## Build the two checkouts

In each repository run `npm ci --ignore-scripts --no-audit --no-fund`, then `npm run build`. The server adds the missing `regenerator-runtime` dependency needed by its existing Vue build. The client build command invokes its existing webpack configuration. Application code in the client remains unchanged.

The client emits inherited lint and bundle-size warnings. Build success is not a clean lint result or dependency security clearance. The original client test command is a failing placeholder; it is not used as evidence.

## Initialize a fresh isolated installation

Choose a new state path outside both checkouts. Use only ASCII letters, digits, slash, dot, underscore and hyphen; other characters are rejected before writing state. Keep the path short enough for PostgreSQL Unix socket names. The directory contains database files, generated credentials and a private TLS key. Do not commit, attach or publish it.

```sh
export NB_BASELINE_STATE="$HOME/nb-lt573-state"
export NB_BASELINE_CLIENT="$HOME/code/libretexts-dev/libretexts-nota-bene-client-baseline"
export NB_BASELINE_PG_BIN=/opt/homebrew/opt/postgresql@16/bin
node scripts/baseline-init.cjs
```

Initialization refuses an existing state directory or existing root `config.js`. Preserve either rather than deleting it to get past the guard. It creates a protected PostgreSQL cluster and `nb_lt573` database, starts only that cluster on `127.0.0.1:55473`, and generates task-only credentials/TLS material. Local Unix socket access is protected by the private state directory; TCP uses password authentication. It writes an ignored placeholder `config.js` because the original model loader requires that file before using `DATABASE_URL`.

## Start and seed

Start in the server checkout with the same environment variables:

```sh
node scripts/baseline-server.cjs
```

The launcher awaits the existing model synchronization and default-tag setup before binding HTTPS on loopback ports 3000 and 3001. It serves the actual client build and the synthetic reading at `https://127.0.0.1:3001/fixture.html`. It reads the generated certificate directly; it does not use upstream development keys or modify system trust. The database schema uses upstream additive synchronization, without force/reset.

Email uses Nodemailer's stream capture transport and cannot send through SMTP in this launcher. Existing upstream email defaults remain unchanged outside this mode. The capture test calls the public send operation with network connections forbidden.

In another terminal, once the launcher prints that it is ready:

```sh
node scripts/baseline-seed.cjs
```

Seeding uses the original authenticated NB APIs to create two synthetic accounts, a course, membership and the local reading. It creates no annotation or reply. It refuses to reseed when its fixture receipt exists. If an interrupted seed has partially created data, preserve the failure and inspect the task state; do not use this procedure to reset it silently.

## Verify the native workflow

Install the matching Playwright Chromium browser once with `npx playwright install chromium`. Use a new lowercase scenario name for a new creation run. Reusing a creation receipt is rejected; reuse that name only for readback. Each results directory must be fresh and empty; the runner checks before Playwright can clean it.

```sh
export NB_BASELINE_RUN=complete
export NB_BASELINE_RESULTS="$HOME/nb-lt573-results/create"
mkdir -p "$NB_BASELINE_RESULTS"
npm run test:baseline:unit
npm run test:baseline
```

The browser signs in through NB's own form, uses actual pointer dragging to select a measured quote, and posts through the original editor. A second user signs in and replies through the original thread controls. Rendered text and authenticated JSON readback must include the acknowledged annotation and reply IDs. The JSON request uses the same Accept header as the native client; a generic HTML request may reach the upstream history fallback.

The harness blocks all non-loopback network requests. Its report records blocked external assets, including upstream CDN styles/scripts, fonts, logos and emoji URLs. This bounded text workflow does not prove math/media rendering or full visual parity. The launcher alone does not block a manually opened browser's inherited external asset URLs; use the harness for this controlled verification. No MIT service data was used.

## Restart without reseeding

Stop the foreground launcher with Ctrl+C. Stop and start only the database identified by the task's data directory:

```sh
"$NB_BASELINE_PG_BIN/pg_ctl" -D "$NB_BASELINE_STATE/pgdata" -m fast -w stop
"$NB_BASELINE_PG_BIN/pg_ctl" -D "$NB_BASELINE_STATE/pgdata" -l "$NB_BASELINE_STATE/postgres.log" -o "-h 127.0.0.1 -p 55473 -k $NB_BASELINE_STATE/sockets" -w start
node scripts/baseline-server.cjs
```

Do not run initialization or seeding again. In the other terminal:

```sh
export NB_BASELINE_PHASE=readback
export NB_BASELINE_RESULTS="$HOME/nb-lt573-results/restart"
mkdir -p "$NB_BASELINE_RESULTS"
npm run test:baseline
```

Readback requires the saved IDs and asserts both records through the actual client and API. Its result must report no annotation/reply creation. Native view/session logging still occurs; this is not a zero-write API audit. Keep screenshots and sanitized results separate from protected state. Stop only the task launcher and this cluster when finished; leave the data available for later readback.

## Acceptance boundaries

The bounded baseline has separate evidence for builds, email capture, native creation/reply, fresh initialization and restart persistence. Source CI runs builds and the capture test; hosted authenticated browser/database restart acceptance is not claimed by that workflow. Independent review and PR/source/postmerge gates remain separate. TestSprite has not run for this slice and has no new budget. A later LibreTexts page adapter, revised anchoring, private/course policy verification, LibreOne/ADAPT/H5P/AI integration and real-course adoption require their own contracts and acceptance.
