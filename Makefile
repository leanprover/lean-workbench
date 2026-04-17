WORKBENCH_ROOT ?= /tmp/lean-workbench
IMAGE_TAG = ghcr.io/leanprover/lean-workbench:latest

.DEFAULT_GOAL := container
.PHONY: clean container clean-install serve dev enter

clean:
	rm -rf node_modules/ .next/
	@test -n "$(WORKBENCH_ROOT)" || { echo "ERROR: WORKBENCH_ROOT is empty"; exit 1; }
	@test "$(realpath $(WORKBENCH_ROOT) 2>/dev/null)" != "/" || { echo "ERROR: WORKBENCH_ROOT resolves to /"; exit 1; }
	rm -rf $(WORKBENCH_ROOT)

container:
	docker build --tag $(IMAGE_TAG) .
	
DOCKER_RUN = docker run --init --interactive --tty \
	--cap-add SYS_ADMIN \
	--security-opt seccomp=unconfined \
	--security-opt apparmor=unconfined \
	--security-opt systempaths=unconfined \
	-v $(WORKBENCH_ROOT)/data:/data \
	$(if $(wildcard .env.docker),--env-file .env.docker,)

clean-install: clean container
	./install.sh --no-pull --dir $(WORKBENCH_ROOT) --port 3000

serve: container
	mkdir -p $(WORKBENCH_ROOT)/data
	$(DOCKER_RUN) -p 3000:3000 $(IMAGE_TAG)

dev: container
	mkdir -p $(WORKBENCH_ROOT)/data
	$(DOCKER_RUN) -p 3000:3000 -e NODE_ENV $(IMAGE_TAG)

enter: container
	mkdir -p $(WORKBENCH_ROOT)/data
	$(DOCKER_RUN) --rm --entrypoint bash $(IMAGE_TAG)