FROM node:22-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ .
RUN npm run build

FROM node:22-alpine
WORKDIR /app

RUN apk update && apk add --no-cache ffmpeg

COPY package*.json ./
RUN npm ci

COPY . .
COPY --from=frontend-builder /app/frontend/dist ./public

ENV NODE_ENV=production

CMD ["npm", "run", "start:bot"]
