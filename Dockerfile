# ---------- Stage 1: Builder ----------
FROM node:20-slim AS builder

WORKDIR /app

# Copia package.json + package-lock.json
COPY package*.json ./

# Installa tutte le dipendenze (incluso dev)
RUN npm ci

# Copia il resto del codice
COPY . .

# Compila TypeScript
RUN npm run build


# ---------- Stage 2: Runtime ----------
FROM node:20-slim AS runtime

WORKDIR /app

# Copia solo package.json per installare solo le deps runtime
COPY package*.json ./

# Installa solo production dependencies
RUN npm ci --omit=dev

# Copia i file compilati e le altre risorse necessarie
COPY --from=builder /app/dist ./dist
COPY public ./public
RUN mkdir -p uploads
# Stage runtime
COPY --from=builder /app/uploads ./uploads

# Espone la porta dell'app
EXPOSE 3000

# Avvia l'app compilata
CMD ["node", "dist/index.js"]
