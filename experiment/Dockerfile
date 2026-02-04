FROM ubuntu:22.04

RUN apt-get update && apt-get install -y \
    curl \
    bubblewrap \
    libatomic1 \
    file \
    && rm -rf /var/lib/apt/lists/*

# Create a non-root user for elan installation
RUN useradd -m -s /bin/bash lean

# Install elan + stable toolchain as the lean user
USER lean
ENV ELAN_HOME=/home/lean/elan
ENV PATH="${ELAN_HOME}/bin:${PATH}"
RUN curl -sSf https://raw.githubusercontent.com/leanprover/elan/master/elan-init.sh | sh -s -- \
    --default-toolchain leanprover/lean4:stable \
    --no-modify-path \
    -y

# Verify installation and save the toolchain prefix
RUN lean --version && lean --print-prefix > /home/lean/lean-prefix.txt
RUN cat /home/lean/lean-prefix.txt

# Make the toolchain readable/traversable by all (needed for bwrap with --unshare-user)
USER root
RUN chmod a+rx /home/lean && chmod -R a+rX /home/lean/elan

# Copy in the entrypoint script
COPY run-lean-bwrap.sh /usr/local/bin/run-lean-bwrap.sh
RUN chmod +x /usr/local/bin/run-lean-bwrap.sh

ENTRYPOINT ["/usr/local/bin/run-lean-bwrap.sh"]
