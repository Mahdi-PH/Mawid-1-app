# ─────────────────────────────────────────────────────────────────────────────
# عميل DUSKFRONT — يُبنى ثم يُقدَّم عبر nginx
# ─────────────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS build
WORKDIR /app

ARG VITE_API_URL=http://localhost:2567
ARG VITE_WS_URL=ws://localhost:2567
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_WS_URL=$VITE_WS_URL

COPY package.json package-lock.json* tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/client/package.json apps/client/
COPY apps/server/package.json apps/server/
RUN npm install --ignore-scripts

COPY packages/shared packages/shared
COPY apps/client apps/client

RUN npm run build -w @duskfront/shared && npm run build -w @duskfront/client

FROM nginx:1.27-alpine AS runtime
COPY --from=build /app/apps/client/dist /usr/share/nginx/html
COPY apps/client/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
