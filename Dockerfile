# ---------- Stage 1: Builder ----------
FROM node:20-slim AS builder

WORKDIR /app

# Copia package.json + package-lock.json
COPY package*.json ./

# Installa tutte le dipendenze (incluso dev)
RUN npm ci

# Copia tutto il codice sorgente
COPY . .

# Compila TypeScript
RUN npm run build


# ---------- Stage 2: Runtime ----------
FROM node:20-slim AS runtime

WORKDIR /app

# Copia solo package.json per installare deps di produzione
COPY package*.json ./
RUN npm ci --omit=dev

# Copia i file compilati e le risorse statiche dallo stage builder
COPY --from=builder /app/dist ./dist
# copia dal builder, non dall'host
COPY --from=builder /app/public ./public

# Prepara cartelle di upload
RUN mkdir -p uploads/firmware uploads/tmp

# Espone la porta dell'app
EXPOSE 3000

# Avvia l'app compilata
CMD ["node", "dist/index.js"]
