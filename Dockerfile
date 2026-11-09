# Production image for Quiz Portal
FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

# Install only production dependencies (cached unless package files change)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY . .

USER node
EXPOSE 3000
CMD ["node", "app.js"]
