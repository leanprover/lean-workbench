FROM buildpack-deps:22.04-curl

RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs nginx strace git \
       meson ninja-build pkg-config libcap-dev xz-utils gcc libc6-dev \
    && rm -rf /var/lib/apt/lists/*

# Build bubblewrap 0.11.0 from source (need --tmp-overlay support; Ubuntu 22.04 only has 0.5.0)
RUN curl -sSfL https://github.com/containers/bubblewrap/releases/download/v0.11.0/bubblewrap-0.11.0.tar.xz \
    | tar -xJ \
    && cd bubblewrap-0.11.0 \
    && meson setup _build --prefix=/usr \
    && ninja -C _build \
    && ninja -C _build install \
    && cd / && rm -rf /bubblewrap-0.11.0

WORKDIR /home/

ARG RELEASE_TAG="openvscode-server-v1.106.3"
ARG RELEASE_ORG="gitpod-io"
ARG OPENVSCODE_SERVER_ROOT="/home/.openvscode-server"

RUN arch=$(uname -m) && \
    if [ "${arch}" = "x86_64" ]; then arch="x64"; \
    elif [ "${arch}" = "aarch64" ]; then arch="arm64"; \
    fi && \
    wget https://github.com/${RELEASE_ORG}/openvscode-server/releases/download/${RELEASE_TAG}/${RELEASE_TAG}-linux-${arch}.tar.gz && \
    tar -xzf ${RELEASE_TAG}-linux-${arch}.tar.gz && \
    mv -f ${RELEASE_TAG}-linux-${arch} ${OPENVSCODE_SERVER_ROOT} && \
    rm -f ${RELEASE_TAG}-linux-${arch}.tar.gz

# Pre-install the Lean4 VS Code extension
ARG LEAN4_EXT_URL="https://github.com/leanprover/vscode-lean4/releases/download/v0.0.221/lean4-0.0.221.vsix"
RUN mkdir -p /home/extensions \
    && wget -q -O /tmp/lean4.vsix "${LEAN4_EXT_URL}" \
    && ${OPENVSCODE_SERVER_ROOT}/bin/openvscode-server \
        --extensions-dir /home/extensions \
        --install-extension /tmp/lean4.vsix \
    && rm /tmp/lean4.vsix

# Copy project templates (source files only; mathlib .lake is admin-managed on the host volume)
COPY templates/ /home/templates/

# Build React client (outputs to /tmp/public/dist/)
COPY client/ /tmp/client/
RUN cd /tmp/client && npm install && npm run build

COPY server/nginx.conf /etc/nginx/nginx.conf
COPY server/package.json server/spawner.ts server/db.ts server/editorSessionManager.ts /usr/local/lib/spawner/
COPY server/migrations/ /usr/local/lib/spawner/migrations/
COPY scripts/ /usr/local/lib/spawner/scripts/
COPY server/public/ /usr/local/lib/spawner/public/
# Copy built React bundle into public/dist/
RUN cp -r /tmp/public/dist/ /usr/local/lib/spawner/public/dist/ && rm -rf /tmp/client /tmp/public
RUN cd /usr/local/lib/spawner && npm install --production
COPY start.sh /usr/local/bin/start.sh
RUN chmod +x /usr/local/bin/start.sh

# Create the user-routes dir for dynamic nginx includes
RUN mkdir -p /etc/nginx/user-routes

ENV OPENVSCODE_SERVER_ROOT=${OPENVSCODE_SERVER_ROOT}
ENV NODE_ENV=production

EXPOSE 3000

ENTRYPOINT ["/usr/local/bin/start.sh"]
