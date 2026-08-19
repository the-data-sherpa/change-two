ARG NODE_IMAGE=node:24.19.0-bookworm-slim@sha256:3638d9a6fe4030bd716be989438248074489337ba3275657f93595428be4fc03
FROM ${NODE_IMAGE} AS dependencies

ARG PNPM_VERSION
ENV PNPM_HOME=/pnpm
ENV PATH=${PNPM_HOME}:${PATH}
WORKDIR /workspace

RUN corepack enable && corepack prepare "pnpm@${PNPM_VERSION}" --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/starter-api/package.json apps/starter-api/package.json
COPY apps/starter-web/package.json apps/starter-web/package.json
COPY packages/protocol/package.json packages/protocol/package.json
COPY packages/evidence/package.json packages/evidence/package.json
RUN pnpm install --frozen-lockfile

FROM dependencies AS source
COPY apps ./apps
COPY fixtures ./fixtures
COPY packages ./packages
COPY requirements ./requirements
COPY schemas ./schemas

FROM source AS development

FROM source AS browser
RUN pnpm --filter "@change-two/starter-web" exec playwright install --with-deps chromium

FROM source AS checked
RUN pnpm check

FROM scratch AS artifacts
COPY --from=checked /workspace/apps/starter-api/dist /starter-api
COPY --from=checked /workspace/apps/starter-web/dist /starter-web
