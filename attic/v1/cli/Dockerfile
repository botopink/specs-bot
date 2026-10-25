# CLI Dockerfile (Bun)
FROM oven/bun:1-alpine AS builder

WORKDIR /app

# Copiar package files
COPY package.json bun.lockb* ./

# Instalar dependências
RUN bun install --frozen-lockfile

# Copiar código fonte
COPY . .

# ============================================
# Production stage
# ============================================
FROM oven/bun:1-alpine AS runner

WORKDIR /app

# Criar usuário não-root
RUN addgroup -g 1001 -S bunjs && \
    adduser -S bunjs -u 1001

# Copiar dependências e código
COPY --from=builder --chown=bunjs:bunjs /app/node_modules ./node_modules
COPY --from=builder --chown=bunjs:bunjs /app/src ./src
COPY --from=builder --chown=bunjs:bunjs /app/package.json ./package.json

# Mudar para usuário não-root
USER bunjs

# Entry point
ENTRYPOINT ["bun", "run", "src/index.ts"]

# Default command (mostrar help)
CMD ["--help"]
