FROM node:22-slim

WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev

COPY index.js README.md server.json glama.json ./
USER node

CMD ["node", "index.js"]
