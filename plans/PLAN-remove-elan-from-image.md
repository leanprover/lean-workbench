status: done

# Plan: Remove elan from the Docker image

## Context

Elan is currently baked into the Docker image at `/home/elan-image/`
and copied to the `/data/elan/` volume on first boot by `start.sh`.
But the admin setup script (`mk-mathlib-package.sh`) already installs
elan into the volume as a prerequisite. The image-baked copy is
redundant.

## Changes

### Dockerfile

- Remove the elan install steps (elan-init.sh, lean --version, pin
  toolchain, chmod).
- Remove the `ELAN_HOME=/home/elan-image` env var.
- This saves ~1 GB from the image (the stable toolchain).

### start.sh

- Remove the seed-copy block (`if [ ! -d /data/elan/bin ]; then ...`).
- The script assumes `/data/elan/` is already populated on the volume.

### Prerequisite

- The admin must run `mk-mathlib-package.sh` (or manually install
  elan) before `docker run`. A bare `make serve` on a fresh volume
  will fail, which is the correct behavior — setup is required.

### Optional: startup check

- `start.sh` could check for `/data/elan/bin/elan` and print a
  helpful error message if it's missing, rather than failing
  cryptically later when bwrap can't find lean.
