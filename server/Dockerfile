# Multi-stage build for the geofight game server (ESM, tsc -> dist/).
# Stage 1 compiles TypeScript with the full dev deps; stage 2 ships only the
# compiled output + production deps for a small runtime image.

# ---- build ----
FROM node:22-slim AS build
WORKDIR /app
# Install all deps (incl. typescript/tsc) against the lockfile.
COPY package.json package-lock.json ./
RUN npm ci
# Bring in the sources and compile to dist/ (tsconfig excludes test/).
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---- runtime ----
FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
# Production deps only (express, cors, socket.io).
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
# Compiled JS from the build stage.
COPY --from=build /app/dist ./dist
# Matches fly.toml internal_port; the server reads PORT (defaults to 3001).
EXPOSE 3001
CMD ["node", "dist/index.js"]
