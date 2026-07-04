FROM node:20-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY index.js README.md LICENSE server.json glama.json GLAMA.md ./

ENV NODE_ENV=production \
  X402_ADS_BASE_URL=https://ads.forgemesh.io

USER node

ENTRYPOINT ["node", "index.js"]
