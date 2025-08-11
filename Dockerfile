FROM node:20-slim

# prepara cartelle e permessi PRIMA di copiare il progetto
WORKDIR /app
RUN mkdir -p /app/uploads/firmware /app/uploads/tmp /app/public && \
    chown -R node:node /app

# install solo dipendenze necessarie
COPY package*.json ./
RUN npm ci --omit=dev

# copia il resto del codice
COPY . .

# build del TS -> dist
RUN npm run build

# esegui come utente non root
USER node

ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "dist/index.js"]
