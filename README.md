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
3. **Render** — either the **HeyGen avatar API** (`HEYGEN_API_KEY`) for a
   talking-creator video, or the **built-in ffmpeg renderer**: 1080×1920 from
   the product images with burned-in captions and an OpenAI TTS voiceover.
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

Needs a persistent server (disk + background jobs), not serverless. Use the
included Dockerfile on Railway/Render/Fly/VPS and attach a volume at
`/app/data`:

```bash
docker build -t postfin .
docker run -d -p 3000:3000 --env-file .env -v postfin-data:/app/data postfin
```

Set `BASE_URL` to the public URL — OAuth callbacks are
`BASE_URL/auth/<platform>/callback`, and platforms fetch generated videos from
`BASE_URL/ugc-media/...`, so it must be internet-reachable.

Storage is SQLite in `data/app.db` by default; set `DATABASE_URL` to use
Postgres/Neon instead. The schema migrates itself on boot for both.

## Auth

`ADMIN_PASSWORD` gates the app (sign in with it from the login page using
any email). Public signups land on a waitlist page and never see the
workspace. Leaving it empty disables auth entirely — local use only.
