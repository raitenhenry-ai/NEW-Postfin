import express from "express";
import path from "node:path";
import config from "./config.js";
import { q1, closeDb, dbKind } from "./db.js";
import authRoutes from "./routes/auth.js";
import apiRoutes from "./routes/ugc.js";
import dashboardRoutes from "./routes/dashboard.js";
import { registerAuthRoutes, authMiddleware, authEnabled } from "./auth.js";
import { recoverStuckUgcJobs, ugcQueueLength } from "./ugc/pipeline.js";
import { startMetricsCollector, stopMetricsCollector } from "./metrics.js";
import { startScheduler, stopScheduler } from "./schedule.js";
import { reportStorage } from "./storage.js";

// Timestamped logs.
for (const level of ["log", "warn", "error"]) {
  const original = console[level].bind(console);
  console[level] = (...args) => original(new Date().toISOString(), ...args);
}

const app = express();
app.disable("x-powered-by");
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Public: health probe and generated videos (Instagram & co fetch the video
// from a URL when publishing, so /ugc-media must be reachable without auth).
app.get("/healthz", async (req, res) => {
  try {
    const accounts = Number((await q1("SELECT COUNT(*) AS n FROM accounts")).n);
    res.json({
      ok: true,
      database: dbKind,
      uptimeSeconds: Math.round(process.uptime()),
      ugcQueue: ugcQueueLength(),
      connectedAccounts: accounts,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err.message || err) });
  }
});
app.use("/ugc-media", express.static(config.ugcDir));

// Meta (Instagram/Facebook/Threads) webhook endpoint: answers the GET
// handshake their app dashboards require and ignores pushed events.
app.get("/webhooks/meta", (req, res) => {
  if (
    req.query["hub.mode"] === "subscribe" &&
    req.query["hub.verify_token"] === config.metaVerifyToken
  ) {
    return res.send(req.query["hub.challenge"]);
  }
  res.sendStatus(403);
});
app.post("/webhooks/meta", (req, res) => res.sendStatus(200));

// Everything below requires the login when ADMIN_PASSWORD is set.
registerAuthRoutes(app);
app.use(authMiddleware);

const publicDir = path.join(config.rootDir, "public");
app.use("/auth", authRoutes);
app.use("/api", apiRoutes);
app.use("/api", dashboardRoutes);
app.use("/", express.static(publicDir));

// Unknown /api paths should read as JSON 404s, not the static handler's HTML.
app.use("/api", (req, res) => res.status(404).json({ error: "Unknown endpoint" }));

const server = app.listen(config.port, async () => {
  console.log(`Postfin running at ${config.baseUrl} (port ${config.port})`);
  if (!authEnabled()) {
    console.warn(
      "[startup] ADMIN_PASSWORD is not set - the studio is open to anyone who can reach it. " +
        "Set it in .env before exposing this server to the internet."
    );
  }
  // Says so loudly when the media directory does not survive restarts, which
  // otherwise shows up much later as a scheduled post with nothing to upload.
  await reportStorage().catch((e) => console.error("[storage] check failed:", e.message || e));

  const recovered = await recoverStuckUgcJobs().catch((e) => {
    console.error("[startup] recovery failed:", e);
    return 0;
  });
  if (recovered) console.log(`[startup] recovered ${recovered} interrupted UGC job(s)`);

  // Analytics collection and scheduled publishing both run in-process.
  startMetricsCollector();
  startScheduler();
});

// Finish in-flight requests, then close cleanly. Interrupted jobs are
// re-queued by recoverStuckUgcJobs() on the next boot.
function shutdown(signal) {
  console.log(`[shutdown] received ${signal}, closing`);
  stopMetricsCollector();
  stopScheduler();
  server.close(async () => {
    await Promise.resolve(closeDb()).catch(() => {});
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 8000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
