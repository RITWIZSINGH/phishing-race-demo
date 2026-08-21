# The demo has zero dependencies, so there is no install step and no build
# stage — the image is the base image plus 244KB of source. That is what makes
# it wake in about a second instead of the ~40s a cold free-tier container takes.
FROM node:20-alpine

WORKDIR /app
COPY . .

# Cloud Run injects PORT (8080 by default); server/index.js already reads it.
ENV NODE_ENV=production
EXPOSE 8080

USER node
CMD ["node", "server/index.js"]
