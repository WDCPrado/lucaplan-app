# App web de LucaPlan (Next.js 16): la web + Prisma, sin navegador → imagen liviana.
# Single-stage a propósito: es una app personal/local, la simpleza gana al tamaño.
FROM node:24-slim

WORKDIR /app
RUN npm install -g pnpm@10

# Deps primero (capa cacheable).
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# Prisma (query/schema engine) necesita OpenSSL; node:*-slim no lo trae → warning "failed to detect libssl".
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*

COPY . .
# prisma generate + next build no conectan a la DB, pero prisma.config.ts exige DATABASE_URL presente
# al cargar. Placeholder solo para este RUN (no persiste en la imagen); el valor real llega en runtime.
RUN DATABASE_URL="postgresql://build:build@127.0.0.1:5432/build?schema=public" pnpm build

EXPOSE 3005
# Arranque: aplica migraciones pendientes (incremental, NUNCA borra datos) y levanta Next en 0.0.0.0
# para que la IP de Tailscale del host lo alcance.
# Escucha en `::` (dual-stack: cubre IPv4 también). La red privada de Railway es IPv6: sin esto,
# la función de cron no alcanza /api/cron/*.
CMD ["sh", "-c", "pnpm exec prisma migrate deploy && pnpm exec next start -p 3005 -H ::"]
