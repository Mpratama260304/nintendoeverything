FROM node:20-alpine

WORKDIR /app

# Copy package files dulu (cache docker layer)
COPY package.json package-lock.json* ./

# Install dependencies
RUN npm ci --only=production 2>/dev/null || npm install --only=production

# Copy source code
COPY . .

# Non-root user untuk security
RUN addgroup -g 1001 -S appgroup && \
    adduser -S appuser -u 1001 -G appgroup
USER appuser

EXPOSE 3000

ENV NODE_ENV=production

CMD ["node", "src/index.js"]
