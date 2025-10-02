# ---------------------------
# Stage 1 — builder (compile TS)
# ---------------------------
FROM node:20-bullseye AS builder

WORKDIR /usr/src/app

# Copy package files first to leverage cache
COPY package.json package-lock.json* ./

# Install dependencies (including puppeteer if present)
RUN npm ci --silent

# Copy all source and build
COPY . .

# Build TypeScript
RUN npm run build

# ---------------------------
# Stage 2 — runtime (smaller)
# ---------------------------
FROM node:20-bullseye-slim AS runtime

# Install system dependencies required by Chromium
RUN apt-get update && apt-get install -y --no-install-recommends \
  ca-certificates \
  fonts-liberation \
  libasound2 \
  libatk1.0-0 \
  libc6 \
  libcairo2 \
  libdbus-1-3 \
  libexpat1 \
  libfontconfig1 \
  libgcc1 \
  libgconf-2-4 \
  libgdk-pixbuf2.0-0 \
  libglib2.0-0 \
  libgtk-3-0 \
  libnspr4 \
  libnss3 \
  libpango-1.0-0 \
  libx11-6 \
  libx11-xcb1 \
  libxcb1 \
  libxcomposite1 \
  libxcursor1 \
  libxdamage1 \
  libxext6 \
  libxfixes3 \
  libxi6 \
  libxrandr2 \
  libxrender1 \
  libxss1 \
  libxtst6 \
  wget \
  unzip \
  chromium \
  chromium-driver \
  && rm -rf /var/lib/apt/lists/*

# Ensure app directory exists (before chown)
WORKDIR /usr/src/app
RUN mkdir -p /usr/src/app

# Copy production artifacts from builder
COPY --from=builder /usr/src/app/package.json ./package.json
COPY --from=builder /usr/src/app/package-lock.json ./package-lock.json
COPY --from=builder /usr/src/app/node_modules ./node_modules
COPY --from=builder /usr/src/app/dist ./dist

# Create and own cache/crash dirs and create user/group idempotently.
# Ensure directories for puppeteer/chromium and crashpad exist and are writable
RUN mkdir -p /home/app/.cache/puppeteer \
    /home/app/.config \
    /tmp/chromium_crash \
    /home/app/.local-chromium \
  && (groupadd -r app || true) \
  && (id -u app >/dev/null 2>&1 || useradd -r -g app app || true) \
  && chown -R app:app /usr/src/app /home/app/.cache /home/app/.config /tmp/chromium_crash /home/app/.local-chromium

# Switch to non-root user
USER app

ENV NODE_ENV=production
ENV PORT=3000
ENV CHROME_EXECUTABLE_PATH=/usr/bin/chromium
EXPOSE 3000

CMD ["node", "dist/main.js"]
