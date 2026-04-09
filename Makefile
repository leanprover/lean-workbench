WORKBENCH_ROOT ?= /tmp/lean-workbench

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
	docker build -t ghcr.io/leanprover/lean-workbench:latest .
	
clean-install: clean container
	./install.sh --no-pull --dir $(WORKBENCH_ROOT) --port 3000 $(if $(wildcard .env),--env-file .env,)

serve: container
	mkdir -p $(WORKBENCH_ROOT)/data
	docker run -it --init \
		--cap-add SYS_ADMIN \
		--security-opt seccomp=unconfined \
		--security-opt apparmor=unconfined \
		--security-opt systempaths=unconfined \
		-p 3000:3000 \
		-v $(WORKBENCH_ROOT)/data:/data \
		$(if $(wildcard .env),--env-file .env,) \
		ghcr.io/leanprover/lean-workbench:latest

dev: container
	mkdir -p $(WORKBENCH_ROOT)/data
	docker run -it --init \
		--cap-add SYS_ADMIN \
		--security-opt seccomp=unconfined \
		--security-opt apparmor=unconfined \
		--security-opt systempaths=unconfined \
		-p 3000:3000 \
		-v $(WORKBENCH_ROOT)/data:/data \
		-e NODE_ENV \
		$(if $(wildcard .env),--env-file .env,) \
		ghcr.io/leanprover/lean-workbench:latest

enter: container
	mkdir -p $(WORKBENCH_ROOT)/data
	docker run --rm -it \
		--cap-add SYS_ADMIN \
		--security-opt seccomp=unconfined \
		--security-opt apparmor=unconfined \
		--security-opt systempaths=unconfined \
		-v $(WORKBENCH_ROOT)/data:/data \
		--entrypoint bash \
		ghcr.io/leanprover/lean-workbench:latest

host-dev: client
	mkdir -p $(WORKBENCH_ROOT)/data $(WORKBENCH_ROOT)/vscode-extensions $(WORKBENCH_ROOT)/nginx/user-routes $(WORKBENCH_ROOT)/log
	openvscode-server --extensions-dir $(WORKBENCH_ROOT)/vscode-extensions --install-extension leanprover.lean4
	DATA_DIR=$(WORKBENCH_ROOT)/data \
	VSCODE_EXTENSIONS_DIR=$(WORKBENCH_ROOT)/vscode-extensions \
	NGINX_CONF_DIR=$(WORKBENCH_ROOT)/nginx \
	NGINX_LOG_DIR=$(WORKBENCH_ROOT)/log \
	./server/start.sh