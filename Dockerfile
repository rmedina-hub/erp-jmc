FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY . .
ENV NODE_ENV=production
ENV PORT=3000
ENV ERP_DB=/data/erp.db
EXPOSE 3000
CMD ["node", "--experimental-sqlite", "server.js"]
