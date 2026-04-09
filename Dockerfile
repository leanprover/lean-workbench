FROM buildpack-deps:24.04-curl

# Install Node.js v24 (LTS)
RUN curl -fsSL https://deb.nodesource.com/setup_24.x | bash - \
   && apt-get install -y nodejs

# Install system packages
RUN apt-get install -y --no-install-recommends nginx strace git \
       meson ninja-build pkg-config libcap-dev xz-utils gcc g++ libc6-dev make gettext-base \
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
ARG LEAN4_EXT_VERSION="0.0.229"
RUN mkdir -p /app/.vscode-extensions \
    && wget -q -O /tmp/lean4.vsix https://github.com/leanprover/vscode-lean4/releases/download/v${LEAN4_EXT_VERSION}/lean4-${LEAN4_EXT_VERSION}.vsix \
    && /app/.openvscode-server/bin/openvscode-server \
        --extensions-dir /app/.vscode-extensions \
        --install-extension /tmp/lean4.vsix \
    && rm /tmp/lean4.vsix

# Copy project templates (source files only; mathlib .lake is admin-managed on the host volume)
COPY templates/ /app/templates/

# FIXME: rollup/esbuild the server?
COPY --parents server/package.json server/src /usr/local/lib
RUN cd /usr/local/lib/server && npm install --omit=dev

COPY --parents scripts server/nginx.conf.template server/start.sh server/migrations server/public /usr/local/lib
RUN chmod +x /usr/local/lib/server/start.sh

# Create the user-routes dir for dynamic nginx includes
RUN mkdir -p /etc/nginx/user-routes

ENV NODE_ENV=production

EXPOSE 3000

ENTRYPOINT ["/usr/local/lib/server/start.sh"]
