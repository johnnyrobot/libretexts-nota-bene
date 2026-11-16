# Isolated native NB demo deployment (LT-575)

This packet deploys the merged native NB baseline, unchanged, as one isolated demo site behind a TLS-terminating reverse proxy. The proposed origin is `https://nb.libretexts.dev`. DNS and routing for that origin belong to the Chief.

Nothing in this repository runs on a host by itself. Every host step below is a Chief activation gate. The read-only preflight is the only script meant to run before the Chief approves provisioning.

This is a synthetic demo. It does not establish institutional production readiness, authorization security, accessibility conformance, grant compliance, or identity with an unpublished NB release. The limits in [NATIVE-BASELINE.md](NATIVE-BASELINE.md) still apply.

## Shape

| Part | Choice |
| --- | --- |
| App | `scripts/demo-server.cjs`: native `app.js` plus the built client under `/client`. Plain HTTP on `127.0.0.1:3475` only. Runs as the unprivileged `nbdemo` user, with outbound network denied by systemd (`IPAddressDeny=any`, loopback allowed). |
| Database | Its own PostgreSQL 16 cluster under `/var/lib/nb-demo/pgdata`, on `127.0.0.1:55475` plus a private socket. It runs as a separate `nbdemo-pg` account. The app uses the non-superuser role `nb_demo` with password auth for database `nb_demo` only. |
| Proxy | One Caddy site block that imports `/etc/caddy/nb-demo.caddy 3475`. It sets the HTTPS headers and CSP, limits request bodies to 1 MB, and closes the endpoints listed below. |
| Releases | Immutable tarballs `nb-demo-<server12>-<client12>-<host>`, each with `RELEASE.json` and `MANIFEST.sha256`, unpacked root-owned under `/opt/nb-demo/releases`. `current` and `previous` are symlinks. |
| Secrets | Generated on the host by `provision-host.sh` into `/etc/nb-demo/*.env` (mode 0640) and `/var/lib/nb-demo-operator/settings.json` (mode 0600). They are never in git or in the release. |
| Accounts | Two fresh synthetic accounts, `demo_alice` and `demo_bob`, with `@demo.invalid` addresses and generated passwords. One course and one reading. No posts are seeded. |
| Email | Capture only (`NB_EMAIL_MODE=capture`). The SMTP path to `outgoing.csail.mit.edu` is never used. |

## Demonstrated blockers and how this packet handles them

These were found by reading the merged native source and checked on the local staging run. App and client source are unchanged. The fixes are config and launcher only.

| Native behavior | Risk on a public host | Handling |
| --- | --- | --- |
| The client build hard-codes `https://127.0.0.1:3000` and `:3001` | It can't reach a public site | `build-release.sh` rewrites exactly that pair to `<origin>` and `<origin>/client`, following upstream's prod layout, and refuses any other bundle shape |
| The baseline launcher serves self-signed HTTPS on 3000/3001 | Wrong for a proxied host | `demo-server.cjs` serves plain HTTP on loopback, and Caddy terminates TLS |
| `GET /api/users/user/:id` is unauthenticated and returns the password hash and reset id | Leaks password hashes | Closed with 404 at the proxy |
| `POST /api/users/getuser {id: reset_password_id}` returns a JWT | Account takeover when combined with the line above | Closed with 404 |
| `/api/users/register`, `/forgotpassword`, `/all`, `/api/admin*`, `/api/email*` | Open sign-up, user listing, admin actions and mail | Closed with 404. Seeding uses loopback |
| `/embed_NB.js`, `/c/*`, `/f/*`, `/pdf4/rpc*`, `/content/*`, `/settings*` 301 to `nb1.mit.edu` | Sends users to MIT app data | Closed with 404 and no `Location` header |
| CORS check uses `Source.findOne` (a Promise, always truthy) | Allows any origin | The CSP limits `connect-src` to `'self'`. socket.io CORS is the single origin. Auth is a bearer token, with no cookies |
| The client loads CDN KaTeX, quill and fontawesome, the `nb.mit.edu` logo and `ding.mp3` | Third-party requests | Blocked by the CSP (`default-src 'self'`) |

The limits this creates are recorded below as known limitations.

## Known limitations of the demo

- **Follow/unfollow doesn't work.** It calls the closed `/api/users/user/*`. A fix belongs in the app, as a follow-up.
- **Media and file uploads fail.** The release is read-only and the request body cap is 1 MB.
- **External CDN styling and the MIT logo are blocked**, so some icons and math rendering are missing.
- **The MIT consent text still appears** in the server UI.
- **The client still bakes `Environments.dev` at build time.** The proper fix is a client PR with a build-time origin. Until then, the bundle rewrite is checked by tests and by the build.
- **App CORS is still permissive** in code. The proxy CSP and the bearer-only auth model contain it, but they don't fix it.

## Workstation: build the release

The server tree must be clean and committed. The client is read with `git archive`, and neither checkout is modified.

```sh
deploy/nb-demo/build-release.sh https://nb.libretexts.dev \
  /path/to/libretexts-nota-bene-client <output-dir> f26b5f7b836c76f2f1196f67c1f733910343b394
```

This writes `<id>.tar.gz`, `<id>.tar.gz.sha256` and `<id>.RELEASE.json`. Releases are origin-specific because the bundle contains the origin.

## Host: Chief activation gates, in order

Every command after step 1 needs the Chief's explicit approval for that step. Nothing here touches another site, its data, or the shared Caddyfile beyond one added site block.

1. **Read-only preflight.** Run as an unprivileged user: `deploy/nb-demo/preflight-readonly.sh nb.libretexts.dev`. It writes nothing, and a unit test enforces that. The Chief accepts it when:
   - Node is v22.
   - PostgreSQL 16 binaries are present.
   - Ports 3475 and 55475 are free.
   - No `nbdemo` or `nbdemo-pg` users or paths exist.
   - DNS resolves to this host.
   - Caddy is active and has no `nb.libretexts.dev` block.
2. **DNS.** Point `nb.libretexts.dev` (A/AAAA) at the host.
3. **Provision.** Run `sudo provision-host.sh https://nb.libretexts.dev <pg-bin-dir>`. It creates the users, the cluster, role and database, the secrets, and the operator settings. It installs the units without enabling or starting them.
4. **Install the release.** Copy the tarball and run `sudo install-release.sh <tar.gz> <sha256>`. This verifies the hash, the manifest and the origin, then runs `npm ci --omit=dev --ignore-scripts` against the release lockfile. It does not switch releases.
5. **Activate.** Run `sudo activate-release.sh <release-id>`. This enables PostgreSQL, takes a backup, switches `current` atomically, starts the app and runs `health.sh`. If health fails, it restores the previous release, or stops the app if there is none.
6. **Seed once.** Run `sudo seed-demo.sh`. It refuses to run if `fixture.json` exists.
7. **Caddy.** Copy `deploy/nb-demo/nb-demo.caddy` to `/etc/caddy/nb-demo.caddy`. Add this block to the Caddyfile:

   ```caddyfile
   nb.libretexts.dev {
       import /etc/caddy/nb-demo.caddy 3475
   }
   ```

   Run `caddy validate`, then reload.
8. **Public smoke.** Run `smoke.sh https://nb.libretexts.dev /var/lib/nb-demo-operator`. It is read-only, apart from NB's own sign-in logging.
9. **Raise HSTS.** After the site is stable, raise `max-age` from 300.
10. **Decide on gating.** Decide whether to put basic auth or the existing `gate` snippet in front of the demo.

Rollback is code only: `sudo rollback.sh`. Restoring data is a separate explicit step: `sudo restore-backup.sh <dir> --confirm-nb-demo-restore`. It takes a safety backup first.

## Local staging rehearsal

The same release, launcher, Caddy snippet, seed, smoke and native Playwright harness run on a workstation against a fresh throwaway PostgreSQL cluster. They use `deploy/nb-demo/Caddyfile.staging` at `https://nb.localhost:<port>`. The harness accepts a staged origin through `NB_BASELINE_ORIGINS=https://nb.localhost:<port>`. In that mode it blocks every other origin, just as it does for the local pair. The `NB_BASELINE_STATE` directory holds `settings.json` and `fixture.json`.

The Linux-only steps are not exercised locally. Those are provisioning, systemd units, the install as root, activate, and backup run as service users.
