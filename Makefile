WORKBENCH_ROOT ?= /tmp/lean-workbench
IMAGE_NAME = ghcr.io/leanprover/lean-workbench
IMAGE_TAG = latest
IMAGE_DEV_TAG = latest-dev

.DEFAULT_GOAL := container
.PHONY: clean container container-dev clean-install serve dev enter

clean:
	rm -rf node_modules/ .next/ next-env.d.ts src/prisma/generated
	@test -n "$(WORKBENCH_ROOT)" || { echo "ERROR: WORKBENCH_ROOT is empty"; exit 1; }
	@test "$(realpath $(WORKBENCH_ROOT) 2>/dev/null)" != "/" || { echo "ERROR: WORKBENCH_ROOT resolves to /"; exit 1; }
	rm -rf $(WORKBENCH_ROOT)

container:
	docker build --tag $(IMAGE_NAME):$(IMAGE_TAG) --target runner-prod .

container-dev:
	docker build --tag $(IMAGE_NAME):$(IMAGE_DEV_TAG) --target runner-dev .

DOCKER_RUN = docker run --rm --init --interactive --tty \
	--cap-add SYS_ADMIN \
	--security-opt seccomp=unconfined \
	--security-opt apparmor=unconfined \
	--security-opt systempaths=unconfined \
	-v $(WORKBENCH_ROOT):/data \
	$(if $(wildcard .env.docker),--env-file .env.docker,)

serve: container
	mkdir -p $(WORKBENCH_ROOT)
	$(DOCKER_RUN) -p 127.0.0.1:3000:3000 $(IMAGE_NAME):$(IMAGE_TAG)

enter: container
	mkdir -p $(WORKBENCH_ROOT)
	$(DOCKER_RUN) --entrypoint bash $(IMAGE_NAME):$(IMAGE_TAG)

dev: container-dev
	mkdir -p $(WORKBENCH_ROOT)
# 3000: Nginx
# 9229: Node.js debugger
	$(DOCKER_RUN) -p 127.0.0.1:3000:3000 \
		-p 127.0.0.1:9229:9229 \
		-v $(CURDIR):/app/workbench:ro \
		$(IMAGE_NAME):$(IMAGE_DEV_TAG)