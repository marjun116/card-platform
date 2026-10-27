# Deploying the test site (Render)

The test site is one Render **web service**: the Node server serves the API, the table
WebSockets and the built website from one address. See docs/decisions.md, "Test
deployment".

## Settings

| Setting | Value |
|---|---|
| Runtime | Node |
| Repository / branch | this repo, `main` |
| Root directory | (empty: the repo root) |
| Build command | `pnpm --version && pnpm install --frozen-lockfile --prod=false && pnpm build` |
| Start command | `pnpm start` |
| Health check path | `/api/health` |
| Auto-deploy | On commit (every push to `main` redeploys) |

`--prod=false` matters: with `NODE_ENV=production` set, pnpm would otherwise skip the
build tools (Vite, Prisma, tsx), and the build would fail.

Don't add `corepack enable`: Render's `pnpm` is in a read-only system folder, so it fails
with `EROFS: read-only file system, unlink '/usr/bin/pnpm'`. Render's `pnpm` follows
`packageManager` in package.json by itself: the first build log printed 12.9.1.

## Environment variables

| Name | Value |
|---|---|
| `NODE_ENV` | `production` (HTTPS-only cookies, serves the website, only `PUBLIC_URL` may open tables) |
| `NODE_VERSION` | `24` |
| `HOST` | `0.0.0.0` (the server listens only on its own machine otherwise) |
| `DATABASE_URL` | the same connection string as in your `.env` (the dev database, for now) |
| `PUBLIC_URL` | the site's address, no trailing slash: `https://card-table-xwdd.onrender.com` |

`PUBLIC_URL` doesn't decide where the site is served (Render does, from the service's
name). The server uses it to accept table connections only from its own pages and to
write sign-in links, so if it doesn't match, pages load but tables never connect.

Render sets `PORT` itself. Without `RESEND_API_KEY`, sign-in links are written to the
service's logs instead of emailed.

## What happens on each deploy

1. Build: install everything, build the website into `apps/web/dist`, generate the
   Prisma client.
2. Start: `prisma migrate deploy` applies any new database migrations, then the server
   starts with `tsx`.
3. Render sends traffic to the new version once `/api/health` answers, then stops the old
   one. Anyone at a table is disconnected for a moment and reconnects on their own;
   games are saved move by move, so nothing is lost.

## Checking it locally first

```
pnpm build
NODE_ENV=production HOST=0.0.0.0 PORT=4310 PUBLIC_URL=http://localhost:4310 pnpm start
```

(With `DATABASE_URL` set in the shell: `pnpm start` doesn't read `.env`.) Then open
http://localhost:4310.
