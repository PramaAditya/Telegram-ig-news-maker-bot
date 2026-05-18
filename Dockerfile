FROM node:22-alpine

WORKDIR /app

# Install ffmpeg for video processing
RUN apk update && apk add --no-cache ffmpeg

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy the rest of the application code
COPY . .

# Generate drizzle client and push schema (optional, usually done in a separate migration step)
# RUN npx drizzle-kit generate

# Build the TypeScript code (if you added a build step, otherwise we use tsx directly)
# Since we use tsx to run directly, we just need to start it

ENV NODE_ENV=production

# Command to run the bot by default (can be overridden by compose)
CMD ["npm", "run", "start:bot"]
