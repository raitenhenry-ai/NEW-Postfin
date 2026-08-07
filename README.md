# Postfin

Paste a **product URL** → Postfin scrapes the product, writes a UGC-style
script with AI, **generates a vertical video**, **schedules it**, and
**publishes it** to every connected social account: TikTok, Instagram
(Reels), YouTube (Shorts), Facebook (Reels), X, Threads, Pinterest and
LinkedIn — then tracks how each post performs.

The dashboard, calendar, analytics, recent-activity and connectors pages are
all driven by this app's own API. There is no mock data anywhere in the UI.

## How a video gets made

1. **Scrape** — JSON-LD / OpenGraph / meta parsing, works on most storefronts.
2. **Script** — hook, spoken scenes, CTA, caption and hashtags via OpenAI, in
   a chosen tone (casual / hyped / pro / storytelling) and style (Product POV,
   GRWM, Unboxing, Before-After, Demo). Falls back to templates without a key.
3. **Render** — either the **HeyGen avatar API** for a talking-creator video,
   or the **built-in ffmpeg renderer**: 1080×1920 from the product images
   with burned-in captions and an OpenAI TTS voiceover. Both output 1080×1920.
   See [Avatar videos with HeyGen](#avatar-videos-with-heygen).
4. **Schedule** — a job with a `scheduledAt` renders immediately and then
   waits at `ready`, so the finished video is previewable on the calendar
   before its slot. Without one it posts as soon as it has rendered.
5. **Post** — to every connected account of the selected platforms, with
   per-account status, links to the live posts, and retries for failures.
6. **Measure** — a background collector polls each platform for view, like,
   comment, share and save counts plus follower totals, and stores a snapshot
   per run. The charts read those snapshots.

## Run it

```bash
cp .env.example .env   # fill in what you use
npm install
npm start              # http://localhost:3000
```

Requirements: Node 18+, ffmpeg + ffprobe on PATH (for the built-in renderer).

## Avatar videos with HeyGen

Set `HEYGEN_API_KEY` and every video is rendered as a talking avatar
speaking the generated script, at 1080×1920. Without it, the built-in
ffmpeg renderer is used instead. `UGC_PROVIDER` forces one or the other
(`auto` | `heygen` | `local`); `auto` means "HeyGen when a key is set".

The key is in HeyGen under **Settings → API**. API access requires a paid
HeyGen plan, and each render spends credits from that plan.

**Picking an avatar.** You don't need to hunt for IDs. The scheduler dialog
lists the avatars and voices this HeyGen account actually has — including
uploaded talking photos — with a preview image, and the pair you choose is
stored on the video. Re-rendering it later reuses the same avatar even if
the workspace default has changed since. `HEYGEN_AVATAR_ID` and
`HEYGEN_VOICE_ID` are only the fallback for videos that don't specify one.

**Check the key works** from the Profile page → Generation → *Test HeyGen
connection*, which lists the avatar count. Worth doing before scheduling a
week of posts, since otherwise a bad key surfaces as a failed render at
publish time.

Two limits worth knowing: the script is truncated to 1500 characters, which
is HeyGen's per-request cap, and HeyGen output has no burned-in captions —
it's the avatar speaking. The built-in renderer is the one that burns
captions in.

## The API

Everything under `/api` requires the login when `ADMIN_PASSWORD` is set.

| Endpoint | Purpose |
| --- | --- |
| `GET /api/dashboard` | Stat tiles, top accounts, top videos, suggestions |
| `GET /api/analytics` | Chart series, engagement totals, recent videos. `?range=1h\|24h\|7d\|30d\|custom&days=N&platform=<key>` |
| `GET /api/calendar` | Jobs keyed by local date. `?start=&end=` (epoch ms) |
| `GET /api/connectors` | Every platform, its credential state and linked accounts |
| `GET /api/recent` | Activity feed: every job with per-account results |
| `GET /api/profile` | Signed-in user, workspace config, integration state |
| `GET /api/overview` | Generator capabilities for the create form |
| `POST /api/jobs` | Create a video. `{ productUrl, title?, scheduledAt?, platforms[], tone, style }` |
| `GET /api/jobs`, `GET /api/jobs/:id` | List / read jobs |
| `PATCH /api/jobs/:id` | Retitle, rewrite caption/hashtags, move the slot |
| `POST /api/jobs/:id/retry` | Re-run a failed job from where it died |
| `POST /api/jobs/:id/regenerate` | Discard script + video and start over |
| `POST /api/jobs/:id/post` | Publish now. `{ onlyFailed: true }` retries failures |
| `DELETE /api/jobs/:id` | Delete a job, its posts and its files |
| `GET /api/heygen` | Avatars and voices on the HeyGen account, for the picker |
| `POST /api/heygen/test` | Check the HeyGen key works |
| `POST /api/plan` | Plan a set of videos from a brief. `{ brief, slots: [epochMs], productUrl?, platforms?, avatarId?, voiceId? }` |
| `POST /api/metrics/refresh` | Collect fresh numbers from the platform APIs now |
| `GET /healthz` | Unauthenticated health probe |

OAuth lives at `/auth/<platform>` and `/auth/<platform>/callback`;
`POST /auth/accounts/:id/disconnect` removes a linked account.

## Analytics and CPM

Metrics come from each platform's own API (`METRICS_INTERVAL_MINUTES`
controls how often, `0` disables collection). Because every number is a
lifetime running total, a gap in collection shows as a flat line rather than
a drop, and growth is measured from the first reading actually observed — a
channel's existing audience is never counted as newly gained.

**No social publishing API reports ad revenue**, so the CPM tile stays blank
unless you supply your own rates via `ESTIMATED_CPM` (dollars per 1000 views)
or the per-platform `ESTIMATED_CPM_<PLATFORM>` overrides. Postfin will not
invent a revenue figure.

Follower counts need the right scope on each app — notably TikTok requires
`user.info.stats` in `TIKTOK_SCOPES`. LinkedIn exposes no per-post stats to a
publishing app, so it contributes no metrics. Accounts whose API call fails
simply stop adding points; nothing else breaks.

## Deploy

**This app cannot run on serverless hosting.** It needs a writable disk for
the SQLite database and generated videos, `ffmpeg` for rendering, and a
process that stays alive between requests for the job queue, the scheduler
and the metrics collector. A static or serverless host will serve the pages
from `public/` and answer every `/api/*` call with its own 404 — the UI
loads but nothing works.

Config files for the three usual hosts are in the repo; all three build the
included Dockerfile, which installs `ffmpeg` and the caption fonts.

**Railway** — `railway.json`. New Project → Deploy from repo. Add a volume
mounted at `/app/data`, then set the variables below.

**Render** — `render.yaml`. New → Blueprint, point it at this repo. The disk
and health check are declared already; it will prompt for the secrets.

**Fly** — `fly.toml`:

```bash
fly launch --no-deploy          # keeps the committed fly.toml
fly volumes create postfin_data --size 10
fly secrets set BASE_URL=https://<app>.fly.dev ADMIN_PASSWORD=... OPENAI_API_KEY=...
fly deploy
```

**Any Docker host / VPS**:

```bash
docker build -t postfin .
docker run -d -p 3000:3000 --env-file .env -v postfin-data:/app/data postfin
```

### Required settings

`BASE_URL` must be the public URL of the deployment. OAuth callbacks are
`BASE_URL/auth/<platform>/callback`, and Instagram, Facebook and Threads
publish by downloading the clip from `BASE_URL/ugc-media/...` — so it has to
be internet-reachable, or publishing fails with a container error.

Storage is SQLite in `data/app.db` by default; set `DATABASE_URL` to use
Postgres instead. The schema migrates itself on boot for both. If you use
SQLite, the volume is not optional: without it the database and every
rendered video are wiped on each deploy.

### Supabase (or any Postgres)

Set `DATABASE_URL` and restart — the app creates and migrates its own tables
on boot. Then **run `supabase.sql` once in the Supabase SQL Editor.**

That step is not optional on Supabase. Supabase publishes every table in the
`public` schema through its REST API and grants the `anon` role access.
Postfin's `accounts` table holds live OAuth access and refresh tokens for
every connected social account, and the anon key is designed to ship in
client-side code. `supabase.sql` enables row-level security on Postfin's
tables and revokes those grants; the app connects as the table owner, which
bypasses RLS, so nothing breaks. It also adds indexes the metrics tables
need once they have real history.

**Which connection string:** Supabase offers a direct connection and a
pooler. Take the **Session pooler** string from Settings → Database — it is
reachable over IPv4, whereas the direct `db.<ref>.supabase.co` host is
IPv6-only unless you have the IPv4 add-on, which many hosts cannot reach.
The transaction pooler (port 6543) also works: the app never uses named
prepared statements, which is the usual thing that breaks under it.

```
DATABASE_URL=postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres
```

SSL is enabled automatically for any non-localhost host. Keep the connection
count modest — the pool is capped at 5, which suits Supabase's free tier.

You still need the volume at `/app/data` even on Postgres: the database
holds the job and metric rows, but the rendered `.mp4` files live on disk,
and Instagram, Facebook and Threads publish by downloading them from your
`BASE_URL`.

### Run exactly one instance

The job queue, the scheduler and the metrics collector all run inside the web
process and hold no cross-instance locks. Two replicas would both pick up the
same due jobs, so a scheduled video can go out twice. The bundled configs all
pin a single instance; keep it that way unless the queue is moved out into a
shared worker.

## Auth

`ADMIN_PASSWORD` gates the app (sign in with it from the login page using
any email). Public signups land on a waitlist page and never see the
workspace. Leaving it empty disables auth entirely — local use only.
