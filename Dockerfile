# Multi-stage build: Node + Python dual runtime
FROM node:22-slim AS base

# Install Python, pip, and build tools for native addons (better-sqlite3)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-venv \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Set up Python venv and install diplomacy
RUN python3 -m venv /app/.venv
ENV PATH="/app/.venv/bin:$PATH"
RUN pip install --no-cache-dir diplomacy

# Install Node dependencies (no --ignore-scripts: better-sqlite3 needs native build)
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/engine/package.json packages/engine/
RUN npm ci

# Copy source and build TypeScript
COPY tsconfig.base.json tsconfig.json ./
COPY packages/shared/ packages/shared/
COPY packages/engine/ packages/engine/
COPY scripts/ scripts/
RUN npm run build

# Production stage
FROM node:22-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-venv \
    fontconfig \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy Python venv from build stage
COPY --from=base /app/.venv /app/.venv
ENV PATH="/app/.venv/bin:$PATH"
ENV PYTHON_PATH="/app/.venv/bin/python3"

# Copy Node modules (includes compiled native addons) and built code
COPY --from=base /app/node_modules node_modules/
COPY --from=base /app/packages/shared/dist packages/shared/dist/
COPY --from=base /app/packages/shared/package.json packages/shared/
COPY --from=base /app/packages/engine/dist packages/engine/dist/
COPY --from=base /app/packages/engine/package.json packages/engine/
COPY --from=base /app/package.json ./
COPY scripts/ scripts/

CMD ["node", "packages/engine/dist/index.js"]
