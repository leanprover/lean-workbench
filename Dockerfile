# syntax=docker/dockerfile:1

# --- base image: Node.js installation shared between builders and runners ---
FROM buildpack-deps:24.04-curl AS base
RUN curl -fsSL https://deb.nodesource.com/setup_24.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

# --- base builder image: build bubblewrap ---
FROM base AS builder-base

RUN apt-get update && apt-get install -y --no-install-recommends \
        meson ninja-build pkg-config libcap-dev xz-utils gcc g++ libc6-dev make \
    && rm -rf /var/lib/apt/lists/*

# Build bubblewrap 0.11.1 from source (need --tmp-overlay support; Ubuntu 24.04 only has 0.9.0)
ARG BUBBLEWRAP_VERSION="0.11.1"
RUN curl -sSfL https://github.com/containers/bubblewrap/releases/download/v${BUBBLEWRAP_VERSION}/bubblewrap-${BUBBLEWRAP_VERSION}.tar.xz \
    | tar -xJ \
    && cd bubblewrap-${BUBBLEWRAP_VERSION} \
    && meson setup _build --prefix=/usr \
    && ninja -C _build \
    && ninja -C _build install \
    && cd / && rm -rf /bubblewrap-${BUBBLEWRAP_VERSION}

# --- base runner image: minimal runtime, no build tools ---
FROM base AS runner-base

RUN apt-get update && apt-get install -y --no-install-recommends \
        nginx strace git libcap2 gettext-base \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app/

# Install openvscode-server
ARG OPENVSCODE_SERVER_VERSION="1.109.5"
RUN arch=$(uname -m) && \
    if [ "${arch}" = "x86_64" ]; then arch="x64"; \
    elif [ "${arch}" = "aarch64" ]; then arch="arm64"; \
    fi && \
    ovsc_tag="openvscode-server-v${OPENVSCODE_SERVER_VERSION}" && \
    wget https://github.com/gitpod-io/openvscode-server/releases/download/${ovsc_tag}/${ovsc_tag}-linux-${arch}.tar.gz && \
    tar -xzf ${ovsc_tag}-linux-${arch}.tar.gz && \
    mv -f ${ovsc_tag}-linux-${arch} /app/.openvscode-server && \
    rm -f ${ovsc_tag}-linux-${arch}.tar.gz

# Install the Lean4 VS Code extension
ARG LEAN4_EXT_VERSION="0.0.234"
RUN mkdir -p /app/.vscode-extensions \
    && wget -q -O /tmp/lean4.vsix https://github.com/leanprover/vscode-lean4/releases/download/v${LEAN4_EXT_VERSION}/lean4-${LEAN4_EXT_VERSION}.vsix \
    && /app/.openvscode-server/bin/openvscode-server \
        --extensions-dir /app/.vscode-extensions \
        --install-extension /tmp/lean4.vsix \
    && rm /tmp/lean4.vsix

# Create the user-routes dir for dynamic nginx includes
RUN mkdir -p /etc/nginx/user-routes

EXPOSE 3000

ENTRYPOINT ["/app/workbench/start.sh"]

# --- dev runner image: /app/workbench is empty, expects host mount ---
FROM runner-base AS runner-dev

COPY --from=builder-base --parents /usr/bin/bwrap /

# --- prod builder image: bundle the Next.js server ---
FROM builder-base AS builder-prod

WORKDIR /app/workbench
COPY . .
RUN npm ci --ignore-scripts && npm rebuild better-sqlite3 \
    && mkdir -p /tmp/build-dummy \
    && npx prisma generate \
    && LEAN_WORKBENCH_DATA_DIR=/tmp/build-dummy \
       BETTER_AUTH_SECRET=build-dummy \
       npx next build \
    && npm prune --omit=dev

# --- prod runner image: /app/workbench contains built server ---
FROM runner-base AS runner-prod

ENV NODE_ENV=production

COPY --from=builder-prod --parents /usr/bin/bwrap /app/workbench /
