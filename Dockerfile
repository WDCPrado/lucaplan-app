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
ARG NEXT_PUBLIC_LANDING_ONLY=false
RUN NEXT_PUBLIC_LANDING_ONLY="$NEXT_PUBLIC_LANDING_ONLY" DATABASE_URL="postgresql://build:build@127.0.0.1:5432/build?schema=public" pnpm build

EXPOSE 3005
HEALTHCHECK --interval=15s --timeout=5s --start-period=60s --retries=10 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3005/login',{signal:AbortSignal.timeout(4000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
# Arranque: aplica migraciones pendientes (incremental, NUNCA borra datos), siembra datos falsos si
# esto es un entorno de PR de Railway (el script se autoexcluye en cualquier otro lado) y levanta
# Next en 0.0.0.0 para que la IP de Tailscale del host lo alcance.
CMD ["sh", "-c", "pnpm exec prisma migrate deploy && pnpm seed:pr && pnpm exec next start -p 3005 -H 0.0.0.0"]
