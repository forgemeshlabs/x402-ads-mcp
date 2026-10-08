FROM node:20-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY index.js x402-guard.js README.md LICENSE server.json glama.json GLAMA.md ./

ENV NODE_ENV=production

USER node

ENTRYPOINT ["node", "index.js"]
