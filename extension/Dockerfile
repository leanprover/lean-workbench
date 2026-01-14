FROM gitpod/openvscode-server:latest

ENV OPENVSCODE_SERVER_ROOT="/home/.openvscode-server"
ENV OPENVSCODE="${OPENVSCODE_SERVER_ROOT}/bin/openvscode-server"
ENV EXT_DIR="/home/openvscode-server/extensions"

RUN mkdir -p ${EXT_DIR}

SHELL ["/bin/bash", "-c"]
RUN \
    urls=(\
        https://github.com/leanprover/vscode-lean4/releases/download/v0.0.221/lean4-0.0.221.vsix \
    )\
    # Create a tmp dir for downloading
    && tdir=/tmp/exts && mkdir -p "${tdir}" && cd "${tdir}" \
    # Download via wget from $urls array.
    && wget "${urls[@]}" && \
    # List the extensions in this array
    exts=(\
        # From filesystem, .vsix that we downloaded (using bash wildcard '*')
        "${tdir}"/* \
    )\
    # Install the $exts
    && for ext in "${exts[@]}"; do ${OPENVSCODE} --extensions-dir ${EXT_DIR} --install-extension "${ext}"; done
