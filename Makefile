WORKBENCH_ROOT ?= /tmp/lean-workbench
IMAGE_TAG = ghcr.io/leanprover/lean-workbench:latest

.DEFAULT_GOAL := container
.PHONY: clean client container clean-install serve dev enter host-dev

clean:
	rm -rf node_modules server/public/dist
	@test -n "$(WORKBENCH_ROOT)" || { echo "ERROR: WORKBENCH_ROOT is empty"; exit 1; }
	@test "$(realpath $(WORKBENCH_ROOT) 2>/dev/null)" != "/" || { echo "ERROR: WORKBENCH_ROOT resolves to /"; exit 1; }
	rm -rf $(WORKBENCH_ROOT)
	
node_modules: package.json package-lock.json client/package.json server/package.json
	npm install

client: node_modules
	cd client && npm run build

container: client
	docker build --tag $(IMAGE_TAG) .
	
DOCKER_RUN = docker run --init --interactive --tty \
	--cap-add SYS_ADMIN \
	--security-opt seccomp=unconfined \
	--security-opt apparmor=unconfined \
	--security-opt systempaths=unconfined \
	-v $(WORKBENCH_ROOT)/data:/data \
	$(if $(wildcard .env),--env-file .env,)

clean-install: clean container
	./install.sh --no-pull --dir $(WORKBENCH_ROOT) --port 3000 $(if $(wildcard .env),--env-file .env,)

serve: container
	mkdir -p $(WORKBENCH_ROOT)/data
	$(DOCKER_RUN) -p 3000:3000 $(IMAGE_TAG)

dev: container
	mkdir -p $(WORKBENCH_ROOT)/data
	$(DOCKER_RUN) -p 3000:3000 \
		-v ./server:/usr/local/lib/server \
		-v /usr/local/lib/server/node_modules \
		-e NODE_ENV \
		$(IMAGE_TAG)

enter: container
	mkdir -p $(WORKBENCH_ROOT)/data
	$(DOCKER_RUN) --rm --entrypoint bash $(IMAGE_TAG)