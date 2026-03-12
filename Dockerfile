# Stage 1: Build
FROM node:20-alpine@sha256:b88333c42c23fbd91596ebd7fd10de239cedab9617de04142dde7315e3bc0afa AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm install --ignore-scripts

COPY . .
RUN npm run build

# Stage 2: Production
FROM node:20-alpine@sha256:b88333c42c23fbd91596ebd7fd10de239cedab9617de04142dde7315e3bc0afa

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm install --omit=dev --ignore-scripts

COPY --from=build /app/dist ./dist

EXPOSE 3000

CMD ["node", "dist/src/mcp_server/bin.js", "http"]