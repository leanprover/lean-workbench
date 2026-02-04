FROM buildpack-deps:22.04-curl

RUN apt-get update && apt-get install -y --no-install-recommends \
        git \
        sudo \
        libatomic1 \
        bubblewrap \
        nginx \
        python3 \
        make \
        g++ \
    && rm -rf /var/lib/apt/lists/*

ENV NVM_DIR=/usr/local/nvm
RUN mkdir -p "$NVM_DIR" \
    && curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash \
    && bash -c '. "$NVM_DIR/nvm.sh" && nvm install 22' \
    && ln -s "$NVM_DIR/versions/node/$(ls "$NVM_DIR/versions/node")" "$NVM_DIR/default"
ENV PATH=$NVM_DIR/default/bin:$PATH

WORKDIR /home/

ARG RELEASE_TAG="openvscode-server-v1.106.3"
ARG RELEASE_ORG="gitpod-io"
ARG OPENVSCODE_SERVER_ROOT="/home/.openvscode-server"

# Downloading the latest VSC Server release and extracting the release archive
# Rename `openvscode-server` cli tool to `code` for convenience
RUN if [ -z "${RELEASE_TAG}" ]; then \
        echo "The RELEASE_TAG build arg must be set." >&2 && \
        exit 1; \
    fi && \
    arch=$(uname -m) && \
    if [ "${arch}" = "x86_64" ]; then \
        arch="x64"; \
    elif [ "${arch}" = "aarch64" ]; then \
        arch="arm64"; \
    elif [ "${arch}" = "armv7l" ]; then \
        arch="armhf"; \
    fi && \
    wget https://github.com/${RELEASE_ORG}/openvscode-server/releases/download/${RELEASE_TAG}/${RELEASE_TAG}-linux-${arch}.tar.gz && \
    tar -xzf ${RELEASE_TAG}-linux-${arch}.tar.gz && \
    mv -f ${RELEASE_TAG}-linux-${arch} ${OPENVSCODE_SERVER_ROOT} && \
    cp ${OPENVSCODE_SERVER_ROOT}/bin/remote-cli/openvscode-server ${OPENVSCODE_SERVER_ROOT}/bin/remote-cli/code && \
    rm -f ${RELEASE_TAG}-linux-${arch}.tar.gz

ARG USERNAME=openvscode-server
ARG USER_UID=1000
ARG USER_GID=$USER_UID

# Creating the user and usergroup
RUN groupadd --gid $USER_GID $USERNAME \
    && useradd --uid $USER_UID --gid $USERNAME -m -s /bin/bash $USERNAME \
    && echo $USERNAME ALL=\(root\) NOPASSWD:ALL > /etc/sudoers.d/$USERNAME \
    && chmod 0440 /etc/sudoers.d/$USERNAME

# Install elan and a stable Lean toolchain
ENV ELAN_HOME=/home/elan
RUN curl -sSf https://raw.githubusercontent.com/leanprover/elan/master/elan-init.sh \
    | sh -s -- -y --default-toolchain leanprover/lean4:stable --no-modify-path
RUN ELAN_HOME=/home/elan /home/elan/bin/lean --version
# Pin the default toolchain to its concrete version so elan doesn't need
# network access to resolve the "stable" alias at runtime.
RUN RESOLVED=$(ls /home/elan/toolchains/) && \
    TOOLCHAIN=$(echo "$RESOLVED" | sed 's|---|:|g' | sed 's|--|/|g') && \
    sed -i "s|^default_toolchain = .*|default_toolchain = \"$TOOLCHAIN\"|" /home/elan/settings.toml
RUN chmod a+rx /home/elan && chmod -R a+rX /home/elan

# Pre-install the Lean4 VS Code extension
ARG LEAN4_EXT_URL="https://github.com/leanprover/vscode-lean4/releases/download/v0.0.221/lean4-0.0.221.vsix"
RUN mkdir -p /home/extensions \
    && wget -q -O /tmp/lean4.vsix "${LEAN4_EXT_URL}" \
    && ${OPENVSCODE_SERVER_ROOT}/bin/openvscode-server \
        --extensions-dir /home/extensions \
        --install-extension /tmp/lean4.vsix \
    && rm /tmp/lean4.vsix

RUN chmod g+rw /home && \
    mkdir -p /home/workspace && \
    chown -R $USERNAME:$USERNAME /home/workspace && \
    chown -R $USERNAME:$USERNAME ${OPENVSCODE_SERVER_ROOT}

COPY nginx.conf /etc/nginx/nginx.conf

# Build the React client
COPY client/ /tmp/build/client/
RUN mkdir -p /tmp/build/public && cd /tmp/build/client && npm install && npm run build

COPY package.json package-lock.json spawner.ts db.ts /usr/local/lib/spawner/
COPY public/ /usr/local/lib/spawner/public/
RUN cp -r /tmp/build/public/dist /usr/local/lib/spawner/public/dist
RUN cd /usr/local/lib/spawner && npm install --production
COPY start.sh /usr/local/bin/start.sh
RUN chmod +x /usr/local/bin/start.sh

# Allow non-root user to run nginx and spawner to write route configs
RUN mkdir -p /var/lib/nginx/body /var/lib/nginx/proxy /var/lib/nginx/fastcgi \
        /etc/nginx/user-routes \
    && chown -R $USERNAME:$USERNAME /var/log/nginx /var/lib/nginx /var/run \
        /etc/nginx/user-routes

RUN mkdir -p /data && chown $USERNAME:$USERNAME /data

USER $USERNAME

WORKDIR /home/workspace/

ENV LANG=C.UTF-8 \
    LC_ALL=C.UTF-8 \
    HOME=/home/workspace \
    EDITOR=code \
    VISUAL=code \
    GIT_EDITOR="code --wait" \
    OPENVSCODE_SERVER_ROOT=${OPENVSCODE_SERVER_ROOT} \
    NODE_ENV=production

# Default exposed port if none is specified
EXPOSE 3000

ENTRYPOINT [ "/usr/local/bin/start.sh" ]
