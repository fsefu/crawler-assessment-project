# NestJS Crawler

A simple, configurable web crawler built with NestJS that demonstrates Axios + Cheerio scraping, BullMQ (Redis) job queueing, Swagger API docs and Jest tests.  
Drop this `README.md` into your repo and paste the contents as-is.

---

## Quick overview

Features

- `POST /crawl` — enqueue a crawl job for a URL (uses Axios + Cheerio to extract data).
- `GET /status/:id` — check job status and, when finished, view the crawl result.
- `DELETE /cancel/:id` — cancel/remove a crawl job.
- Swagger UI at `/api`.
- BullMQ + ioredis for queueing and background workers.
- Jest unit tests + basic e2e tests included.
- Config driven (see `.env.example`).

This project intentionally keeps the crawler logic minimal and easy to extend (e.g. Puppeteer / proxies for Part 2).

---

## Prerequisites

- Node.js (tested with **v24.4.0** — your environment may work with other Node 18/20/24 versions)
- npm or pnpm/yarn
- Docker (recommended for running Redis in development)
- Redis (v6/7) — required for BullMQ

---

## Quick start (development)

1. Clone the repo and install dependencies

```bash
git clone <your-repo-url>
cd <repo>
npm install
```

2. Copy environment vars

```bash
cp .env.example .env
# edit .env if you need to change defaults
```

3. Start Redis (recommended via Docker Compose)

Create `docker-compose.yml` (see the provided example below) and run:

```bash
docker compose up -d
```

4. Start the app (development)

```bash
npm run start:dev
# or for production:
# npm run build
# npm run start:prod
```

By default the server starts on the port configured in `.env` (3000 by default). Swagger UI will be available at `http://localhost:3000/api`.

---

## Docker Compose (example)

Save this as `docker-compose.yml` in the repo root:

```yaml
version: '3.8'
services:
  redis:
    image: redis:7-alpine
    container_name: nestjs-crawler-redis
    ports:
      - '6379:6379'
    command: ['redis-server', '--appendonly', 'no']
    healthcheck:
      test: ['CMD', 'redis-cli', 'ping']
      interval: 10s
      timeout: 5s
      retries: 5
```

Run:

```bash
docker compose up -d
```

If your Redis is password-protected, set `REDIS_PASSWORD` in `.env`.

---

## Environment variables (`.env.example`)

Create `.env` from the example file. Example content:

```
PORT=3000
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_PASSWORD=
QUEUE_PREFIX=nestjs-crawler
QUEUE_NAME=crawl-queue
AXIOS_TIMEOUT=15000
USER_AGENT=Mozilla/5.0 (compatible; NestCrawler/1.0)
REMOVE_ON_COMPLETE=flase
REMOVE_ON_FAIL=true
JOB_ATTEMPTS=3
```

**Notes**

- `REDIS_PASSWORD` — set if your Redis requires AUTH. If you get `ReplyError: NOAUTH Authentication required.` set this.
- `QUEUE_NAME` and `QUEUE_PREFIX` ensure queues do not collide when multiple apps share a Redis instance.
- `AXIOS_TIMEOUT` and `USER_AGENT` are used by the crawler HTTP client.

---

## API

### Swagger

Open Swagger UI at:

```
http://localhost:3000/api
```

### Endpoints

#### POST `/crawl`

Enqueue a crawl job.

Request body (JSON):

```json
{
  "url": "https://example.com"
}
```

Response:

```json
{
  "id": "job-id",
  "status": "waiting" // or queued/active/completed/failed
}
```

#### GET `/status/:id`

Get job metadata and result once completed.

Response (when completed):

```json
{
  "id": "job-id",
  "name": "crawl",
  "data": { "url": "https://example.com" },
  "state": "completed",
  "attemptsMade": 0,
  "finishedOn": 1690000000000,
  "processedOn": 1690000000000,
  "result": {
    "title": "Example",
    "metaDescription": "desc",
    "favicon": "https://example.com/favicon.ico",
    "scripts": ["https://example.com/a.js"],
    "styles": ["https://example.com/a.css"],
    "images": ["https://example.com/img.png"],
    "url": "https://example.com"
  }
}
```

#### DELETE `/cancel/:id`

Cancel and remove job.

Response:

```json
{
  "id": "job-id",
  "cancelled": true
}
```

---

## How the crawler works (summary)

- Incoming `POST /crawl` adds a job to a BullMQ queue (`QUEUE_NAME`).
- A Worker (created by `QueueService`) processes jobs with the `CrawlerService.processJob()` function.
- `processJob()` uses Axios to fetch the page and Cheerio to parse:
  - `<title>`
  - meta description (`meta[name="description"]` or `og:description`)
  - favicon (common `<link rel=...>` patterns)
  - script `src` URLs
  - stylesheet `href` URLs
  - image `src` / `data-src` URLs
- Results are returned as the Job result and visible in `GET /status/:id`.

---

## Tests

Run all tests (unit + e2e) with coverage:

```bash
npm test
```

Run unit tests only (fast, no Redis required):

```bash
npm run test:unit
# Equivalent: npx jest --testPathPatterns "test/.*\.spec\.ts$"
```

Run e2e tests (uses the e2e test pattern defined in jest.config.js or the script):

```bash
npm run test:e2e
# Or run a single e2e file directly:
# npx jest test/app.e2e-spec.ts --runInBand
```

**Notes**

- The e2e test suite in this repo mocks `QueueService` by default so Redis is not required for the tests included here. If you want a true integration test that uses Redis and real workers, start Redis (`docker compose up -d`) and remove the QueueService mock in the test file.
- If you encounter Jest CLI warnings about `testPathPattern`, make sure your `package.json` scripts use `--testPathPatterns` (plural) or add the patterns to `jest.config.js`.

## Common troubleshooting

- `ReplyError: NOAUTH Authentication required.` — set `REDIS_PASSWORD` in `.env` to the Redis password.
- Worker not running / jobs stuck — ensure the Nest app is running a worker (the worker is created on app start via `CrawlerService.onModuleInit`) and Redis is reachable at `REDIS_HOST:REDIS_PORT`.
- Jobs not removed — check `REMOVE_ON_COMPLETE` / `REMOVE_ON_FAIL` env vars; default behavior in this repo may keep job history for debugging.

---

## Security & production considerations

**Important before exposing this service publicly:**

1. **SSRF protection** — validate `url` input and disallow private IP ranges (127.0.0.1, 10.x, 172.16.x, 192.168.x). Optionally maintain an allowlist.
2. **Rate limiting / authentication** — limit requests per client (per IP or API key). Use NestJS `@nestjs/throttler` or an API gateway.
3. **Crawl politeness** — consider robots.txt checks and rate-limiting per host.
4. **Resource caps** — limit worker concurrency and job payload sizes.
5. **Job lifecycle** — configure `removeOnComplete` to avoid unlimited growth of job records in Redis, or persist results to a DB and prune jobs.
6. **Proxy / headless browsing** — for Part 2, integrate Puppeteer with rotating user agents and proxies (configure via env variables).
7. **Logging & monitoring** — log job lifecycle events and expose metrics for alerting.

---

## Development notes & TODO (Part 1 -> ready checklist)

Recommended items to finish before marking Part 1 as complete:

- [ ] Use `config.queueName` everywhere (no hard-coded queue identifiers).
- [ ] Use configured `AXIOS_TIMEOUT` and `USER_AGENT`.
- [ ] Resolve relative URLs to absolute URLs (so assets are usable outside the origin page).
- [ ] Deduplicate and cap arrays (scripts, styles, images) to avoid huge responses.
- [ ] Improve favicon detection (apple-touch-icon, mask-icon, manifest, msapplication).
- [ ] Add input validation and SSRF protections (deny private IPs).
- [ ] Add README (`this file`) and `.env.example`.
- [ ] Add `docker-compose.yml` for easy Redis startup.
- [ ] Add tests for `QueueService` + worker behavior and integration tests that exercise enqueue → worker → completion.

---

## Extending to Part 2 (brief)

When moving to Part 2 you will:

- Add Puppeteer-based browsing (headless) to render JS-heavy pages.
- Implement rotating user agents and rotating proxies (read proxy settings from env).
- Add rate limiting / concurrency per target host and proxy pool management.
- Ensure tests mock Puppeteer or run in a controlled environment.

---

## Example `package.json` scripts (recommended)

Add these scripts if you don't have equivalents:

```json
"scripts": {
  "start": "node dist/main.js",
  "start:dev": "nest start --watch",
  "build": "nest build",
  "test": "jest --coverage",
  "test:e2e": "jest --config ./test/jest-e2e.json"
}
```

---

## Contributing

If you want me to:

- produce PR-style patches for the suggested code fixes,
- implement missing tests (`QueueService`, improved `processJob` tests),
- create `docker-compose.yml` + `.env.example` files,

tell me which one and I’ll generate those files/patches for you.

---

## License

Add a license file to your repo (e.g. `MIT`) or replace this section with your chosen license.

---

Thanks — paste this into your repo as `README.md`. If you want, I can now generate the `.env.example`, `docker-compose.yml`, and exact code patches for the `CrawlerService` and `QueueService` files to match the README recommendations. Which of those should I create next?
