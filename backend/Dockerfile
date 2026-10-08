FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
# Simulateur de devices (service `simulator`, profile du docker-compose) :
# lancé via tsx, non compilé dans dist/.
COPY scripts ./scripts

RUN npx prisma generate
RUN npm run build

EXPOSE 3000

CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
