# syntax=docker/dockerfile:1.7

FROM node:20-bookworm-slim AS build
WORKDIR /repo/apps/mcp-aros

RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

COPY tsconfig.json /repo/tsconfig.json
COPY apps/mcp-aros/package.json package.json
COPY apps/mcp-aros/tsconfig.json tsconfig.json
COPY apps/mcp-aros/src src

RUN pnpm install --no-frozen-lockfile
RUN pnpm build

FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /repo/apps/mcp-aros/dist ./dist
COPY --from=build /repo/apps/mcp-aros/node_modules ./node_modules
COPY apps/mcp-aros/package.json ./package.json

USER node
EXPOSE 5468
CMD ["node", "dist/server.js"]
