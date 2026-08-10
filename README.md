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
2. **Script** — for an **avatar** video: hook, spoken scenes, CTA, caption and
   hashtags via OpenAI, in a chosen tone (casual / hyped / pro / storytelling)
   and style (Product POV, GRWM, Unboxing, Before-After, Demo). For a
   **slideshow**: slides, each with its own on-screen line, voiceover line and
   image prompt. Falls back to templates without a key.
3. **Render** — either the **HeyGen avatar API** for a talking-creator video,
   or the **built-in slideshow renderer**: AI-generated slide art, one big
   overlay per slide, a voiceover, cut together with ffmpeg. Both output
   1080×1920. See [The two formats](#the-two-formats).
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

Requirements: Node 18+, and ffmpeg + ffprobe on PATH for the slideshow
format (the Docker image installs both).

## The two formats

Every video is one of two things, chosen per video and stored on it:

| | **avatar** | **slideshow** |
|---|---|---|
| What it is | a person talking to camera | images cutting every few seconds under one big line of text, with a voiceover |
| Needs | `HEYGEN_API_KEY` | `OPENAI_API_KEY` + ffmpeg |
| Good for | a physical product someone can hold | software, apps, tool comparisons, method videos — anything with nothing to film |
| Cost per video | HeyGen credits | roughly $0.10–$1.50 of image generation, see below |

`UGC_FORMAT` sets the default (`avatar` unless you change it). The calendar
assistant asks which one you want before it generates, and can re-render an
existing video as the other format.

### Slideshow ads

The format short-form advertising for software actually uses. A slideshow is
planned as slides rather than scenes, and each slide carries three things:
the **overlay** burned on screen, the **spoken** line under it, and an
**image prompt**. The rules the planner is held to come from how the format
works, not from taste:

- **Slide 1 is the ad.** Most viewers decide inside a couple of seconds, so
  the hook is a concrete claim or tension — never a greeting, never the
  product name on its own.
- **It has to read with the sound off.** Overlays are capped at ~8 words and
  the overlays alone tell the story slide by slide; the voiceover carries the
  detail they had no room for.
- **Everything sits in the safe zone.** Overlay text lives in the
  upper-middle band, clear of the caption block and the action rail, so the
  platform UI never covers it.
- **The art carries no text.** Image models still garble small type, so
  slide art is asked to be wordless and calm in the upper third; the overlay
  is burned in afterwards at a known size, over a gradient scrim so white
  text stays legible on a bright photo.
- **Real photos beat drawn ones.** When the video came from a product URL,
  the planner can put a scraped product photo on any slide instead of a
  generated image.

Pick the shape of the ad with `angle`:

| angle | what it builds |
|---|---|
| `tool_comparison` | the alternatives, what each gets wrong, then yours |
| `money_method` | "how I make X doing Y", one step per slide |
| `problem_solution` | the frustration, made worse, then resolved |
| `feature_demo` | a walkthrough, one screen per slide |
| `before_after` | the messy way, then the same job after |
| `listicle` | "5 things I wish I knew", one per slide |

**Check image access before you schedule a week.** `gpt-image-1` is gated
behind OpenAI's *organisation verification*, separately from the rest of the
API — so a key that writes scripts perfectly well can be unable to draw a
single slide, and the 403 says so in as many words. Profile → Generation →
*Test slide image generation* draws one cheap image (about a cent) and shows
you either "works" or the API's own refusal. If it refuses: verify the org in
**Settings → Organization → General**, wait a few minutes for it to
propagate, and make sure the key belongs to the org you verified.

**Cost.** Slide art is generated with OpenAI's image model
(`OPENAI_IMAGE_MODEL`, default `gpt-image-1`) at 1024×1536, the portrait size
closest to 9:16. `OPENAI_IMAGE_QUALITY` (`low` | `medium` | `high`, default
`medium`) drives both look and price: a six-slide ad is roughly $0.10 at low,
$0.38 at medium and $1.50 at high, plus a few cents of TTS.

**When image generation goes wrong**, the three cases are treated
differently, because they mean different things:

| what happened | what the video does |
|---|---|
| rate limit, timeout, server error | retried with backoff, then rendered normally |
| one slide refused on safety grounds | that slide falls back to a plain card, the video renders, and the calendar says which slide and why — a refusal is deterministic, so it is not retried |
| the key cannot use the image model at all, or every slide failed | the video **fails** with the API's own message, rather than silently shipping a stack of blank cards |

Only a run with no OpenAI key at all renders as plain text on gradients,
which is a documented degraded mode rather than a silent one.

Tune it with `UGC_SLIDE_COUNT` (3–10, default 6), `UGC_SLIDE_SECONDS` (the
fallback slide length when there is no voiceover to time against),
`OPENAI_IMAGE_TIMEOUT_MS` (default 150000), `UGC_TTS_VOICE` and `FONT_PATH`.

## Avatar videos with HeyGen

Set `HEYGEN_API_KEY` and avatar videos are rendered as a talking avatar
speaking the generated script, at 1080×1920. Without it, an avatar video
fails with that reason - switch the video to the slideshow format, which
needs no HeyGen account, or set `UGC_FORMAT=slideshow` to make that the
default for new videos.

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
it's the avatar speaking. The slideshow format is the one that burns text
in, which is also why it survives being watched with the sound off.

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
| `POST /api/jobs` | Create a video. `{ productUrl, title?, scheduledAt?, platforms[], tone, style, format?, angle?, slides? }` |
| `GET /api/jobs`, `GET /api/jobs/:id` | List / read jobs |
| `PATCH /api/jobs/:id` | Retitle, rewrite caption/hashtags, move the slot |
| `POST /api/jobs/:id/retry` | Re-run a failed job from where it died |
| `POST /api/jobs/:id/regenerate` | Discard script + video and start over |
| `POST /api/jobs/:id/post` | Publish now. `{ onlyFailed: true }` retries failures |
| `DELETE /api/jobs/:id` | Delete a job, its posts and its files |
| `GET /api/heygen` | Avatars and voices on the HeyGen account, for the picker |
| `POST /api/heygen/test` | Check the HeyGen key works |
| `POST /api/images/test` | Check this key can generate slide art, for about a cent |
| `POST /api/plan` | Plan a set of videos from a brief. `{ brief, slots: [epochMs], productUrl?, platforms?, format?, angle?, slides?, avatarId?, voiceId? }` |
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

### Postgres (Neon, Supabase, anything)

Set `DATABASE_URL` and restart. The app creates its tables, applies its
migrations and adds its indexes on boot — there is no schema to run first.
SSL is enabled automatically for any non-localhost host, and a connection
that is refused briefly during a deploy is retried before the app gives up.
If it can't connect at all it says why, naming the host and the likely
cause, rather than dying with a driver stack trace.

**Neon** — copy the connection string from the project dashboard:

```
DATABASE_URL=postgresql://<user>:<password>@ep-<id>-pooler.<region>.aws.neon.tech/<db>?sslmode=require
```

Prefer the **pooled** endpoint (the host containing `-pooler`). Neon
suspends an idle database and takes a few seconds to wake, which the
startup retry already absorbs.

**Supabase** — take the **Session pooler** string from Settings → Database,
not "Direct connection": the direct `db.<ref>.supabase.co` host is IPv6-only
without the IPv4 add-on, and many hosts can't reach it. That mismatch shows
up as a connection timeout on deploy.

On Supabase only, also **run `supabase.sql` once in the SQL Editor**.
Supabase publishes every `public` table through its REST API and grants the
`anon` role access to them — and Postfin's `accounts` table holds live OAuth
access and refresh tokens, while the anon key is meant to ship in
client-side code. That file enables row-level security and revokes those
grants. Postfin connects as the table owner, which bypasses RLS, so nothing
breaks. Neon has no such API, so this step does not apply there.

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
