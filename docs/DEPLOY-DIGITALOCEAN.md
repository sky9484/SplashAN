# Deploying Splash to DigitalOcean

Two supported paths. **App Platform** (Option A) is the least work and is
recommended; a **Droplet** (Option B) gives you full control and is cheaper at
steady load. Both build from the GitHub repos this project pushes to
(`sky9484/phase1` / `mega-ideas/latest-splash`).

---

## Before either path — one-time checklist

1. **Commit and push** the current tree (see repo root README for branch
   conventions). App Platform deploys from GitHub, so anything uncommitted
   never reaches the server.
2. **Verify locally** — these must all pass before pushing:
   ```powershell
   npm run lint
   npm run test:oxwal
   npm run build
   ```
3. **Collect production secrets.** The app REFUSES logins in production unless
   all three customer-auth vars are set (`lib/server/customer-auth.ts`):

   | Variable | Required | Notes |
   |---|---|---|
   | `CUSTOMER_SESSION_SECRET` | **Yes** | ≥32 random chars: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
   | `CUSTOMER_EMAIL` / `CUSTOMER_PASSWORD` | **Yes** | Production login; the dev fallback (`splash@demo`) is disabled in prod |
   | `ADMIN_EMAIL` / `ADMIN_PASSWORD` / `ADMIN_SESSION_SECRET` | Yes | Admin console |
   | `ANTHROPIC_API_KEY` (+ `ANTHROPIC_MODEL`) | Recommended | Without it 0xWal runs the local planner (still functional) |
   | `NEXT_PUBLIC_APP_URL` | **Yes** | e.g. `https://v1.splashz.xyz` — used by the request-origin guard |
   | `ALLOWED_ORIGINS` | Optional | Comma-separated extra origins allowed to POST |
   | `SUI_NETWORK`, `SUI_RPC_URL`, `SPLASH_PACKAGE_ID`, `SPLASH_TREASURY_ID`, `SPLASH_PEG_STATE_ID`, `SPLASH_COMPLIANCE_CONFIG_ID`, `SPLASH_ADMIN_CAP_ID`, `SPLASH_BUSINESS_ACCOUNT_ID`, `DEEPBOOK_POOL_ID`, `DEEPBOOK_QUOTE_TYPE`, `USDC_TYPE` | For live settlement | Copy from your working `.env.local` |
   | `OPERATOR_SUI_ADDRESS` / `OPERATOR_SUI_PRIVATE_KEY` | For live settlement | Funded ED25519 key. **Set as encrypted/secret env vars only** |
   | `SUI_SETTLEMENT_MODE` | Yes | `auto` (recommended), `live`, or `simulate` for demos |
   | `CRON_SECRET` | Yes if using cron routes | Protects `/api/cron/*` |
   | Walrus/Seal/MemWal/Sumsub vars | Feature-dependent | Copy the keys you use from `.env.local` |

   Never commit `.env.local`. Enter these in the DO dashboard.

---

## Option A — DigitalOcean App Platform (recommended)

1. **Create the app**: DO dashboard → *Apps* → *Create App* → GitHub →
   authorize → pick `sky9484/phase1`, branch `main`, autodeploy on push.
2. **Resource type**: Web Service (Node.js is auto-detected).
   - Build command: `npm run build`
   - Run command: `npm run start` (Next.js binds `0.0.0.0:$PORT` automatically;
     App Platform sets `PORT`)
   - Instance: at least **1 GB RAM** (Next builds are memory-hungry; 512 MB
     often OOMs). Start with Basic 1 GB / 1 vCPU, scale later.
3. **Environment variables**: App → Settings → App-Level Environment
   Variables. Add everything from the checklist. Mark secrets as *Encrypt*.
   Set `NODE_ENV=production` (App Platform usually sets this already).
4. **Deploy**: Save → it builds and deploys. Watch the build logs; the first
   build takes several minutes.
5. **Domain**: App → Settings → Domains → add `v1.splashz.xyz` (or your
   domain), then add the CNAME record DO shows you at your DNS provider.
   HTTPS certificates are automatic.
   - After the domain is live, make sure `NEXT_PUBLIC_APP_URL` matches it
     exactly — the origin guard (`lib/auth/customer-request.ts`) accepts the
     forwarded host, but the explicit URL is the belt-and-braces config.
6. **Redis (only if you use it)**: `docker-compose.yml` runs Redis for local
   dev. If production needs it, create a *DO Managed Redis* database and set
   its connection string in env; App Platform containers don't run compose
   files.
7. **Cron routes**: DO → App → Settings → *Scheduled Jobs* (or an external
   cron) hitting `https://<domain>/api/cron/update-peg` etc. with
   `Authorization: Bearer $CRON_SECRET`.

**Redeploys**: push to `main` → App Platform rebuilds automatically. Deleted
files disappear from the server because every deploy is a fresh build of the
commit.

---

## Option B — Droplet (Ubuntu 24.04 + Node + PM2 + Nginx)

1. **Create the Droplet**: Ubuntu 24.04, Basic, ≥2 GB RAM. Add your SSH key.
2. **Install runtime**:
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
   sudo apt-get install -y nodejs nginx
   sudo npm i -g pm2
   ```
3. **Get the code**:
   ```bash
   sudo adduser --system --group splash
   sudo -u splash git clone https://github.com/sky9484/phase1.git /opt/splash
   cd /opt/splash
   ```
4. **Environment**: create `/opt/splash/.env.local` (chmod 600, owner
   `splash`) with the production values from the checklist. `npm run start`
   loads it via Next's env handling.
5. **Build and run**:
   ```bash
   sudo -u splash npm ci
   sudo -u splash npm run build
   sudo -u splash pm2 start npm --name splash -- run start
   sudo -u splash pm2 save && pm2 startup   # follow the printed command
   ```
6. **Nginx reverse proxy** (`/etc/nginx/sites-available/splash`):
   ```nginx
   server {
     listen 80;
     server_name v1.splashz.xyz;
     location / {
       proxy_pass http://127.0.0.1:3000;
       proxy_http_version 1.1;
       proxy_set_header Host $host;
       proxy_set_header X-Forwarded-Host $host;
       proxy_set_header X-Forwarded-Proto $scheme;
       proxy_set_header Upgrade $http_upgrade;
       proxy_set_header Connection "upgrade";
       # SSE (0xWal stream) — don't buffer event streams
       proxy_buffering off;
       proxy_read_timeout 3600;
     }
   }
   ```
   `X-Forwarded-Host`/`X-Forwarded-Proto` are REQUIRED — the customer origin
   guard trusts them to recognize the public origin. `proxy_buffering off`
   is REQUIRED for the 0xWal chat stream; with buffering on, nginx holds the
   SSE frames and the chat appears dead.
   ```bash
   sudo ln -s /etc/nginx/sites-available/splash /etc/nginx/sites-enabled/
   sudo nginx -t && sudo systemctl reload nginx
   ```
7. **HTTPS**: `sudo apt install certbot python3-certbot-nginx && sudo certbot --nginx -d v1.splashz.xyz`
8. **Redis (optional)**: `sudo apt install redis-server` or use the compose
   file: `docker compose up -d redis`.
9. **Updates**:
   ```bash
   cd /opt/splash && sudo -u splash git pull && sudo -u splash npm ci \
     && sudo -u splash npm run build && sudo -u splash pm2 restart splash
   ```
   `git pull` removes files deleted upstream, so unused-file cleanups
   propagate on every update.

---

## Post-deploy smoke test (either path)

1. `https://<domain>/login` → sign in with the production customer creds.
2. Dashboard 0xWal chat → send "What can you read and prepare?" → the chat
   should expand and stream a reply (claude mode if `ANTHROPIC_API_KEY` is
   set; local planner otherwise). If you see "could not open a secure line",
   check the SSE/nginx notes above and the origin guard env vars.
3. Transfer → complete a quote (`/api/quotes` 200) and, if settlement is
   configured, a full send.
4. Batch → upload `samples/batch-payout-sea-1.csv` → screen → authorize.
5. Invoices → both tabs (vault + inspection loop) load; `/dashboard/0xwal`
   redirects into the loop tab.
6. `/queue` renders the approval lanes.
