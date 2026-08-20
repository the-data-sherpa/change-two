ARG NODE_IMAGE=node:24.19.0-bookworm-slim@sha256:3638d9a6fe4030bd716be989438248074489337ba3275657f93595428be4fc03
FROM ${NODE_IMAGE}

ARG PNPM_VERSION=11.22.0
ENV PNPM_HOME=/pnpm
ENV PATH=/runtime/packages/runner/node_modules/.bin:${PNPM_HOME}:${PATH}
WORKDIR /runtime

RUN corepack enable && corepack prepare "pnpm@${PNPM_VERSION}" --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/starter-api/package.json apps/starter-api/package.json
COPY apps/starter-web/package.json apps/starter-web/package.json
COPY apps/results/package.json apps/results/package.json
COPY packages/protocol/package.json packages/protocol/package.json
COPY packages/evidence/package.json packages/evidence/package.json
COPY packages/runner/package.json packages/runner/package.json
COPY packages/sanitizer/package.json packages/sanitizer/package.json
RUN pnpm install --frozen-lockfile
RUN test "$(node -p "require('/runtime/packages/runner/node_modules/@anthropic-ai/claude-code/package.json').version")" = "2.1.226"
RUN test "$(node -p "require('/runtime/packages/runner/node_modules/@openai/codex/package.json').version")" = "0.147.0"
COPY packages/runner/src/egress-proxy.mjs /runtime/egress-proxy.mjs
