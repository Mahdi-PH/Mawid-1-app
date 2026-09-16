# ─────────────────────────────────────────────────────────────────────────────
# خادم DUSKFRONT — بناء متعدّد المراحل
# ─────────────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS build
WORKDIR /app

# argon2 يحتاج أدوات بناء أصلية
RUN apk add --no-cache python3 make g++ libc6-compat

COPY package.json package-lock.json* tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/client/package.json apps/client/
RUN npm ci --ignore-scripts=false --workspaces --include-workspace-root || npm install

COPY packages/shared packages/shared
COPY apps/server apps/server
COPY prisma prisma

RUN npm run build -w @duskfront/shared \
 && npx prisma generate --schema prisma/schema.prisma \
 && npm run build -w @duskfront/server

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache libc6-compat tini

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/apps/server/package.json ./apps/server/package.json
COPY --from=build /app/prisma ./prisma

EXPOSE 2567
USER node
ENTRYPOINT ["/sbin/tini", "--"]
# الترحيل والبذر اختياريان عبر متغيرات البيئة، ثم يقلع الخادم
# مسارات ثنائية مباشرة بدل npx: لا بحث في الشبكة ولا كتابة في ذاكرة npx المؤقتة
CMD sh -c '\
  set -e; \
  if [ "$RUN_MIGRATIONS" = "true" ]; then ./node_modules/.bin/prisma migrate deploy --schema prisma/schema.prisma; fi; \
  if [ "$RUN_SEED" = "true" ]; then node apps/server/dist/seed.js; fi; \
  exec node apps/server/dist/index.js'
