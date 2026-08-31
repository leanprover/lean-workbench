WORKBENCH_ROOT ?= lean-workbench-data
IMAGE_NAME = ghcr.io/leanprover/lean-workbench
IMAGE_TAG = latest
IMAGE_DEV_TAG = latest-dev
# Extra flags for `docker build`, e.g. --cache-from/--cache-to in CI.
DOCKER_BUILD_FLAGS ?=
# VSCode's build process opens thousands of files
DOCKER_BUILD_ULIMIT = --ulimit nofile=65536
# IP Address where the HTTP server publishes to port 3000 (needs to be 0.0.0.0 in some situations)
WORKBENCH_PUBLISH_IP ?= 127.0.0.1
# Where the Docker's container ~/.cache lives, used mostly for Lean's download cache
DOCKER_CACHE_DIR ?= $(CURDIR)/.docker-cache

.DEFAULT_GOAL := container
.PHONY: clean container container-dev test clean-install serve dev enter

clean:
	rm -rf node_modules/ .next/ next-env.d.ts src/prisma/generated
	@test -n "$(WORKBENCH_ROOT)" || { echo "ERROR: WORKBENCH_ROOT is empty"; exit 1; }
	@test "$(realpath $(WORKBENCH_ROOT) 2>/dev/null)" != "/" || { echo "ERROR: WORKBENCH_ROOT resolves to /"; exit 1; }
	rm -rf $(WORKBENCH_ROOT)
	
vscode-workbench.vsix: $(shell find vscode-workbench/src -type f) $(shell find vscode-workbench/media -type f) vscode-workbench/.vscodeignore vscode-workbench/esbuild.mjs vscode-workbench/package.json vscode-workbench/tsconfig.json package.json package-lock.json
	cd vscode-workbench && npx vsce package --out ../vscode-workbench.vsix

collab-server/dist/server.js: $(shell find collab-server/src -type f) collab-server/esbuild.mjs collab-server/package.json collab-server/tsconfig.json package.json package-lock.json
	npm --workspace collab-server run build

container: vscode-workbench.vsix collab-server/dist/server.js
	docker build $(DOCKER_BUILD_FLAGS) $(DOCKER_BUILD_ULIMIT) --tag $(IMAGE_NAME):$(IMAGE_TAG) --target runner-prod .

container-dev:
	docker build $(DOCKER_BUILD_FLAGS) $(DOCKER_BUILD_ULIMIT) --tag $(IMAGE_NAME):$(IMAGE_DEV_TAG) --target runner-dev .

test:
# Test vscode-workbench using VS Code with our patches applied.
# `--output type=cacheonly` skips the expensive image export at the end.
# `--progress=plain` displays RUN step output (notably the testing step).
	docker build $(DOCKER_BUILD_FLAGS) $(DOCKER_BUILD_ULIMIT) --target tester-vscode-workbench --output type=cacheonly --progress=plain .

DOCKER_RUN = docker run --rm --init --tty \
	--cap-add SYS_ADMIN \
	--security-opt seccomp=unconfined \
	--security-opt apparmor=unconfined \
	--security-opt systempaths=unconfined \
	-v $(WORKBENCH_ROOT):/data \
	$(if $(wildcard .env.docker),--env-file .env.docker,)

serve: container
	mkdir -p $(WORKBENCH_ROOT)
	$(DOCKER_RUN) -p $(WORKBENCH_PUBLISH_IP):3000:3000 $(IMAGE_NAME):$(IMAGE_TAG)

enter: container
	mkdir -p $(WORKBENCH_ROOT)
	$(DOCKER_RUN) --interactive --entrypoint bash $(IMAGE_NAME):$(IMAGE_TAG)

dev: container-dev
	mkdir -p $(WORKBENCH_ROOT)
# Ports bound on localhost by the container:
# 3000: Nginx
# 9229: Node.js debugger
	npx concurrently --names host,docker --kill-others-on-fail \
		'npm run watch' \
		'$(DOCKER_RUN) -p $(WORKBENCH_PUBLISH_IP):3000:3000 \
			-p 127.0.0.1:9229:9229 \
			-v $(DOCKER_CACHE_DIR):/root/.cache \
			-v $(CURDIR):/app/workbench:ro \
			-v $(CURDIR)/vscode-workbench:/app/vscode-server/lib/vscode/extensions/leanprover.workbench-universal:ro \
			$(IMAGE_NAME):$(IMAGE_DEV_TAG)'