FROM ubuntu:22.04

# Avoid prompts from apt
ENV DEBIAN_FRONTEND=noninteractive

# Install dependencies
RUN apt-get update && apt-get install -y \
    git \
    curl \
    python3 \
    make \
    g++ \
    libx11-dev \
    libxkbfile-dev \
    libsecret-1-dev \
    ca-certificates \
    build-essential \
    libkrb5-dev \
    python-is-python3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace
SHELL ["/bin/bash", "-c"]

# Install nvm
RUN curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
ENV NVM_DIR=/root/.nvm

RUN git clone https://github.com/gitpod-io/openvscode-server.git --depth 1

WORKDIR /workspace/openvscode-server

# Use node version from openvscode-server/.nvmrc
RUN . /root/.nvm/nvm.sh --no-use && nvm install && nvm use

RUN . /root/.nvm/nvm.sh && npm install

RUN . /root/.nvm/nvm.sh && npm ci

WORKDIR /workspace/openvscode-server/remote
RUN . /root/.nvm/nvm.sh && npm ci
WORKDIR /workspace/openvscode-server

RUN . /root/.nvm/nvm.sh && \
    ln -sf $(which node) /usr/local/bin/node && \
    ln -sf $(which npm) /usr/local/bin/npm && \
    node --version

RUN npm run gulp core-ci && \
    npm run gulp extensions-ci

# Download built-in extensions (language support, themes, etc.)
RUN npm run download-builtin-extensions

# Create a non-root user
# RUN useradd -m vscode && chown -R vscode:vscode /workspace
# USER vscode

# Expose the default port
EXPOSE 3000

WORKDIR /workspace/openvscode-server/out

# Set the entrypoint
CMD ["node", "/workspace/openvscode-server/out/server-main.js", "--host", "0.0.0.0", "--without-connection-token"]

# build: docker build -t podserver .
# run:  docker run -it --init -p 3000:3000  podserver:latest
