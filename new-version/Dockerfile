FROM buildpack-deps:22.04-curl

RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

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

ENV OPENVSCODE_SERVER_ROOT=${OPENVSCODE_SERVER_ROOT}

EXPOSE 3000

ENTRYPOINT ["/home/.openvscode-server/bin/openvscode-server", \
    "--host", "0.0.0.0", \
    "--port", "3000", \
    "--without-connection-token"]
