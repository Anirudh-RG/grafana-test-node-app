FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
# Install necessary build tools
RUN apk add --no-cache python3 make g++
RUN npm install --omit=dev
COPY . .

FROM node:22-alpine
WORKDIR /app
COPY --from=builder /app .
EXPOSE 3000

# Set Node.js flags for better memory handling
ENV NODE_OPTIONS="--expose-gc --max-old-space-size=930"

# Use node with garbage collection enabled
CMD ["node", "--expose-gc", "app.js"]