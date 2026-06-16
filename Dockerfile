# syntax=docker/dockerfile:1

# --- base image: Node.js installation shared between builders and runners --
FROM buildpack-deps:24.04-curl AS base
# Should match code-server/.node-version, checked out at CODE_SERVER_VERSION.
# Code-server 4.124.2 specifically hangs in CI on Node.js 24.16 due to
# https://github.com/microsoft/playwright/issues/40998
# and https://github.com/nodejs/node/issues/63487.
ARG NODE_VERSION="24.15.0"
RUN curl -sSfL https://deb.nodesource.com/setup_24.x | bash - \
    && apt-get update \
    && apt-get install -y --no-install-recommends "nodejs_${NODE_VERSION}-1nodesource1" \
    && rm -rf /var/lib/apt/lists/*

# --- code-server builder: build code-server with our patches ---
FROM base AS builder-code-server

# Build prerequisites (see code-server/docs/CONTRIBUTING.md "Requirements")
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        build-essential g++ make pkg-config python-is-python3 \
        libx11-dev libxkbfile-dev libsecret-1-dev libkrb5-dev \
        git git-lfs jq quilt rsync unzip \
    && rm -rf /var/lib/apt/lists/* \
    && git lfs install

# Shallow-clone code-server at the release tag and fetch its VS Code submodule.
ARG CODE_SERVER_VERSION="4.124.2"
RUN git clone --branch "v${CODE_SERVER_VERSION}" --depth 1 \
        https://github.com/coder/code-server /code-server \
    && git -C /code-server submodule update --init --depth 1
WORKDIR /code-server

# Build (see code-server/docs/CONTRIBUTING.md)
RUN quilt push -a
# `--foreground-scripts` streams node-gyp's native-build output, hidden by default.
# However, it also serializes the execution of `prepare` scripts across different packages.
# To recover some parallelism, `JOBS=max` parallelizes each package's native build.
RUN JOBS=max npm_config_foreground_scripts=true npm install

# Apply our patches on top of code-server's.
# We assume that these don't modify `package.json`, so `npm install` can be cached.
COPY code-server-patches/ /code-server-patches
RUN for p in /code-server-patches/*.diff; do \
      [ -e "$p" ] || continue; echo "Applying $p"; patch -p1 -d lib/vscode < "$p"; \
    done

# Build code-server with a remote extension host (REH).
RUN npm run build
RUN VERSION="${CODE_SERVER_VERSION}" npm run build:vscode
# Lands in /code-server/release
RUN KEEP_MODULES=1 npm run release

# Build again, this time the upstream VS Code Desktop target.
# This is needed by @vscode/test-electron which we use to test vscode-workbench.
# FIXME: can we avoid building twice?
RUN arch=$(uname -m) \
    && if [ "${arch}" = "x86_64" ]; then arch="x64"; \
       elif [ "${arch}" = "aarch64" ]; then arch="arm64"; \
       else echo "unsupported architecture: ${arch}" >&2; exit 1; fi \
    && cd /code-server/lib/vscode \
    && npm run gulp -- vscode-linux-${arch}-min \
    && mv /code-server/lib/VSCode-linux-${arch} /vscode-desktop

# --- vscode-workbench tester: test our extension with patched VS Code ---
FROM base AS tester-vscode-workbench

# Dependencies for headless Electron and headless X server.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        xvfb \
        libgtk-3-0t64 libgbm1 libnss3 libnspr4 libasound2t64 \
        libatk1.0-0t64 libatk-bridge2.0-0t64 libcups2t64 libdrm2 \
        libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libxkbcommon0 \
        libxshmfence1 libpango-1.0-0 libcairo2 libdbus-1-3 \
    && rm -rf /var/lib/apt/lists/*

# Minimal set of files needed to build vscode-workbench.
COPY --parents vscode-workbench/ package.json package-lock.json tsconfig.json /workbench/
RUN cd /workbench && npm clean-install --ignore-scripts

COPY --from=builder-code-server /vscode-desktop /vscode-desktop
RUN cd /workbench/vscode-workbench \
    && APP_NAME="$(node -p "require('/vscode-desktop/resources/app/product.json').applicationName")" \
    && VSCODE_EXECUTABLE_PATH="/vscode-desktop/${APP_NAME}" \
       xvfb-run --auto-servernum npm run test

# --- base builder image: build and download prerequisites ---
FROM base AS builder-base

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        meson ninja-build pkg-config libcap-dev xz-utils gcc g++ libc6-dev make unzip

# Will be copied to runner images
RUN mkdir /app

# Build bubblewrap 0.11.1 from source (need --tmp-overlay support; Ubuntu 24.04 only has 0.9.0)
ARG BUBBLEWRAP_VERSION="0.11.1"
RUN curl -sSfL https://github.com/containers/bubblewrap/releases/download/v${BUBBLEWRAP_VERSION}/bubblewrap-${BUBBLEWRAP_VERSION}.tar.xz \
    | tar -xJ \
    && cd bubblewrap-${BUBBLEWRAP_VERSION} \
    && meson setup _build --prefix=/usr --buildtype=release \
    && ninja -C _build \
    && ninja -C _build install \
    && cd / && rm -rf /bubblewrap-${BUBBLEWRAP_VERSION}

COPY --from=builder-code-server /code-server/release /app/vscode-server

# Install builtin VS Code extensions. Workbench users get a read-only view of these.
# Cannot use `--install-builtin-extension` as it does not store in the builtin directory
# (behaves identically to `--install-extension`).
# FIXME: we install older even-better-toml at 0.19.1 since newer versions leak memory
# (https://github.com/tamasfe/taplo/issues/768#issuecomment-3431613488).
# Should be removed once leanprover.lean4 moves to using tombi-toml instead.
RUN install_vsix_as_builtin() { \
        wget -q -O /tmp/ext.vsix "https://open-vsx.org/api/$1/$2/$3/file/$1.$2-$3.vsix" \
        && unzip -q /tmp/ext.vsix "extension/*" -d /tmp \
        && mv /tmp/extension "/app/vscode-server/lib/vscode/extensions/$1.$2-universal" \
        && rm -rf /tmp/ext.vsix; \
    } \
    && install_vsix_as_builtin "leanprover" "lean4" "0.0.237" \
    && install_vsix_as_builtin "tamasfe" "even-better-toml" "0.19.1" \
    && install_vsix_as_builtin "mathematic" "vscode-pdf" "0.1.11"

# --- base runner image: runtime plus common tools ---
FROM base AS runner-base

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        nginx strace git libcap2 gettext-base \
        build-essential \
        texlive-latex-base texlive-latex-recommended texlive-latex-extra \
        texlive-pictures texlive-fonts-recommended texlive-fonts-extra \
        texlive-luatex texlive-xetex texlive-plain-generic \
        ghostscript inkscape \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app/

# Create the user-routes dir for dynamic nginx includes
RUN mkdir -p /etc/nginx/user-routes

COPY --from=builder-base --parents /usr/bin/bwrap /

EXPOSE 3000

ENTRYPOINT ["/app/workbench/start.sh"]

# --- dev runner image: /app/workbench and vscode-workbench are empty, expect host mounts ---
FROM runner-base AS runner-dev

# Tools for interactive development
RUN apt-get update \
    && apt-get install -y --no-install-recommends htop \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder-base /app /app

# --- prod builder image: bundle the extension and the Next.js server ---
FROM builder-base AS builder-prod

# Install production build of workbench extension
COPY ./vscode-workbench.vsix /tmp/ext.vsix
RUN unzip -q /tmp/ext.vsix "extension/*" -d /tmp \
    && mv /tmp/extension /app/vscode-server/lib/vscode/extensions/leanprover.workbench-universal \
    && rm -rf /tmp/ext.vsix

COPY . /app/workbench
RUN cd /app/workbench \
    && npm clean-install \
    && mkdir -p /tmp/build-dummy \
    && LEAN_WORKBENCH_DATA_DIR=/tmp/build-dummy \
       npx next build \
    && npm prune --omit=dev

# --- prod runner image: /app/ contains built server and workbench extension ---
FROM runner-base AS runner-prod

ENV NODE_ENV=production

COPY --from=builder-prod /app /app
