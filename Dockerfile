# MỘT image cho mọi process (api / worker / scheduler / migrate) — chỉ khác lệnh chạy.
# node:22-slim (glibc) thay vì alpine (musl): native module (nếu sau này cần) build ổn định hơn trên glibc.
ARG NODE_IMAGE=node:22-slim

# --- deps: đủ devDependencies để biên dịch -------------------------------------
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# --- build: tsc -> dist/ ---------------------------------------------------------
FROM deps AS build
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# --- prod-deps: chỉ dependencies chạy thật ----------------------------------------
FROM ${NODE_IMAGE} AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# --- runtime ------------------------------------------------------------------
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./
# Migration đi cùng image: job `migrate` chạy từ chính image này (dist/src/entrypoints/migrate.js).
COPY --chown=node:node drizzle ./drizzle
USER node
# Mặc định chạy api; compose đổi command cho worker / scheduler / migrate.
EXPOSE 3000
CMD ["node", "dist/src/entrypoints/api.js"]
