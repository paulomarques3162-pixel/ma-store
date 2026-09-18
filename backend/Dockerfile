# =============================================================================
# Dockerfile da API - MA STORE
# Build multi-stage: imagem final leve, sem devDependencies.
# =============================================================================
FROM node:20-alpine AS deps
WORKDIR /app
RUN apk add --no-cache openssl
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci
RUN npx prisma generate

FROM node:20-alpine AS build
WORKDIR /app
RUN apk add --no-cache openssl
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
RUN apk add --no-cache openssl && addgroup -S app && adduser -S app -G app
ENV NODE_ENV=production
COPY package*.json ./
COPY prisma ./prisma
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
RUN npx prisma generate && chown -R app:app /app
USER app
EXPOSE 3333
# O start roda as migrations pendentes antes de subir a API.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
