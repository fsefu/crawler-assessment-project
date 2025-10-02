# NestJS Crawler — Part 1 (Axios/Cheerio) + Part 2 (Puppeteer, Proxies)

A configurable web crawler built with NestJS. This repository implements two stages:

- **Part 1:** Axios + Cheerio HTML scraping, BullMQ (Redis) job queue, Swagger API, Jest tests.
- **Part 2:** Optional Puppeteer-based headless browsing, rotating user-agents, proxy rotation (proxy-chain), rate-limiting, job cancellation, and helper tooling for verification.

This README covers how to run both parts, configuration options, troubleshooting, and verification steps for proxy usage.

---

## Quick overview

**Features (combined):**

- `POST /crawl` — enqueue a crawl job for a URL (Axios/Cheerio by default; Puppeteer when enabled).
- `GET /status/:id` — check job status and view the crawl result once finished.
- `DELETE /cancel/:id` — cancel/remove a crawl job (sets a cancel flag so running jobs can abort gracefully).
- Swagger UI at `/api`.
- BullMQ + ioredis for queueing and background workers.
- Jest unit tests + e2e tests included (Puppeteer is optional for tests).
- Config-driven via `.env`.

This project intentionally keeps crawler logic easy to extend.

---

## Prerequisites

- Node.js (recommended: Node 18/20/24; project tested with Node 24).
- npm / yarn / pnpm.
- Redis (v6/7) — required for BullMQ. Docker recommended for local Redis.
- For Part 2 (Puppeteer): either install `puppeteer` (downloads Chromium) or `puppeteer-core` + point `CHROME_EXECUTABLE_PATH` to a system Chrome/Chromium binary.

---

## Quick start (development)

### A — Run with Docker (recommended)

This runs the app + Redis via `docker compose` and is the easiest way to get an environment identical across machines.

1. Build images (fresh build, pulls base images):

```bash
docker compose build --no-cache --pull
```

2. Start the stack (app + redis):

```bash
docker compose up -d
```

3. Watch application logs:

```bash
docker compose logs -f app
```

4. Verify the app is up:

```bash
# confirms HTTP 200 on root
curl -i http://localhost:3000/
# or open http://localhost:3000/api in a browser for Swagger
```

**Notes for Docker**
- The compose file in this repo starts a Redis service. If you already run Redis on the host, either stop it (so the compose file can bind port `6379`) or edit `docker-compose.yml` to remove the `ports:` mapping (Redis will still be reachable from the app inside the compose network).
- If you enable Puppeteer (`USE_PUPPETEER=true`), ensure the Docker image includes Chromium (the provided Dockerfile does) or set `CHROME_EXECUTABLE_PATH` to a system Chrome binary.

---

### B — Run locally with npm (development)

If you prefer to run and iterate locally (fast edits, hot reload):

1. Install dependencies:

```bash
npm install
```

2. Copy the example env and modify if required:

```bash
cp .env.example .env
# edit .env: set REDIS_HOST/REDIS_PORT, USE_PUPPETEER, PROXY_LIST, etc.
```

3. Start Redis (locally or via Docker). Example using Docker:

```bash
docker run -d --name local-redis -p 6379:6379 redis:7-alpine
```

(Or use your system Redis; ensure `.env` points to it.)

4. Start the Nest app in development mode (watch mode):

```bash
npm run start:dev
```

5. Verify:

```bash
curl -i http://localhost:3000/
# open http://localhost:3000/api for Swagger
```
Server default: `http://localhost:3000` — Swagger UI available at `http://localhost:3000/api`.

## Environment variables (`.env.example`)

Below is a suggested `.env.example`. Add or edit fields as needed.

```
# Server
PORT=3000

# Redis
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_PASSWORD=

# Queue
QUEUE_PREFIX=nestjs-crawler
QUEUE_NAME=crawl-queue

# Axios / general
AXIOS_TIMEOUT=15000
USER_AGENT=Mozilla/5.0 (compatible; NestCrawler/1.0)

# Job removal / retries
REMOVE_ON_COMPLETE=false
REMOVE_ON_FAIL=true
JOB_ATTEMPTS=3
JOB_TIMEOUT_MS=120000

# Puppeteer and proxies (Part 2)
USE_PUPPETEER=false                      # set to true to enable Puppeteer path
PUPPETEER_HEADLESS=true                  # set to false to debug with visible browser
CHROME_EXECUTABLE_PATH=                  # optional: path to system chrome when using puppeteer-core

# Proxy config
PROXY_ROTATION=true
PROXY_LIST=                              # comma-separated list, e.g. http://user:pass@1.2.3.4:8080,http://2.2.2.2:8080
PROXY_PROVIDER_API_URL=                  # optional external provider
PROXY_PROVIDER_API_KEY=

# User agents — separate entries with | (pipe)
USER_AGENTS=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36|Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Safari/605.1.15|Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36|Mozilla/5.0 (iPhone; CPU iPhone OS 15_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.4 Mobile/15E148 Safari/604.1|Mozilla/5.0 (Linux; Android 12; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/103.0.0.0 Mobile Safari/537.36

# Concurrency & rate-limiting
MAX_CONCURRENCY=3
RATE_LIMIT_REQUESTS=10
RATE_LIMIT_INTERVAL_MS=1000

# Misc
REMOVE_ON_COMPLETE=true
REMOVE_ON_FAIL=true
```

**Notes**

- `USER_AGENTS` uses `|` as delimiter to avoid splitting user agent strings containing commas.
- `PROXY_LIST` format: `http://user:pass@host:port` or `http://host:port`.
- Use `CHROME_EXECUTABLE_PATH` with `puppeteer-core` to avoid downloading Chromium in CI/hosts.

---

## API

### Swagger

Open Swagger UI:

```
http://localhost:3000/api
```

### Endpoints

#### POST `/crawl`

Enqueue a crawl job. Request body:

```json
{ "url": "https://example.com" }
```

Optional query param for debugging: `?wait=true&timeout=45000` will cause the endpoint to wait up to `timeout` ms for the job to finish and return the final job status (useful for debugging; avoid in production).

Response (immediate):

```json
{ "id": "job-id", "status": "waiting" }
```

#### GET `/status/:id`

Returns job metadata and `result` once job completes. `result` structure (example):

```json
{
  "title": "Example",
  "metaDescription": "desc",
  "favicon": "https://example.com/favicon.ico",
  "scripts": ["https://example.com/a.js"],
  "styles": ["https://example.com/a.css"],
  "images": ["https://example.com/img.png"],
  "url": "https://example.com",
  "externalIp": "54.23.45.67" // only present when using Puppeteer probe
}
```

`externalIp` is an optional probe added to the Puppeteer path that reports the outward-facing IP seen by the headless browser (useful to verify proxy usage).

#### DELETE `/cancel/:id`

Cancel and remove a job. The service sets a cancel flag in Redis so running workers can abort gracefully.

Response:

```json
{ "id": "job-id", "cancelled": true }
```

---

## How the crawler works (summary)

**Part 1 (default)**

- `POST /crawl` adds a job to a BullMQ queue.
- Worker invoked by `QueueService` calls `CrawlerService.processJob()`.
- `processJob()` uses Axios to fetch HTML and Cheerio to parse the DOM for title, meta description, favicon, scripts, stylesheets, and image URLs.
- Results returned as the job return value (visible in `GET /status`).

**Part 2 (Puppeteer + proxies)**

- When `USE_PUPPETEER=true` the worker runs the Puppeteer path (`PuppeteerCrawlerService.crawl`).
- The Puppeteer flow:
  - Optionally picks a proxy from `PROXY_LIST` (rotating) and anonymizes it via `proxy-chain`.
  - Launches `puppeteer-extra` (optionally with stealth plugin) and configures the page with a rotated user-agent from `USER_AGENTS`.
  - Navigates to the target URL with `networkidle2` (falls back to `domcontentloaded` on timeout to avoid hangs).
  - Extracts the same fields as Part 1 (title, meta, favicon, scripts, styles, images).
  - Probes `https://api.ipify.org?format=json` from the page to capture `externalIp` (shows the IP used by the browser — helps verify proxy).
  - Returns the crawl result.

**Cancellation**

- `DELETE /cancel/:id` sets a Redis flag (`cancel:<jobId>`). Running jobs check this flag and throw to abort if set.

---

## Verifying proxy usage (quick)

1. Set `USE_PUPPETEER=true` and add `PROXY_LIST` with a known proxy.
2. Enqueue a job: `POST /crawl` with the target URL.
3. Poll `GET /status/:id` — when completed, inspect `result.externalIp`.
4. Compare with your server public IP (run `curl https://api.ipify.org?format=json` from your host). If `externalIp` differs, the request went through the proxy.

Alternative: run `mitmproxy` or any proxy you control and observe traffic.

---

## Tests

Run all tests with coverage:

```bash
npm test
```
Run unit tests only

```bash
npm run test:unit
```

Run end-to-end

```bash
npm run test:e2e
```


Unit tests mock Axios or QueueService by default. Puppeteer-related code is lazy-required — keep `USE_PUPPETEER=false` in test env or mock runtime requires.

---

---

## Security & production considerations

- **SSRF protection** — validate `url` payloads and block private IP ranges.
- **Rate limiting / authentication** — expose API only to authenticated clients and throttle requests per key/IP.
- **Robots & politeness** — respect robots.txt if required by policy.
- **Resource caps** — limit concurrency so Puppeteer does not exhaust memory/CPU.
- **Proxy provider & costs** — using residential rotating proxies is often costly; design a health-check and blacklisting for failing proxies.

---
_End of README_
