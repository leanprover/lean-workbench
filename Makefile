DATA_DIR ?= /tmp/lean-workbench

.DEFAULT_GOAL := container
.PHONY: clean client container clean-install serve dev enter

clean:
	rm -rf node_modules server/public/dist
	@test -n "$(DATA_DIR)" || { echo "ERROR: DATA_DIR is empty"; exit 1; }
	@test "$(realpath $(DATA_DIR) 2>/dev/null)" != "/" || { echo "ERROR: DATA_DIR resolves to /"; exit 1; }
	rm -rf $(DATA_DIR)
	
node_modules: package.json package-lock.json client/package.json server/package.json
	npm install

client: node_modules
	cd client && npm run build

container: client
	docker build -t ghcr.io/leanprover/lean-workbench:latest .
	
clean-install: clean container
	./install.sh --no-pull --dir $(DATA_DIR) --port 3000 $(if $(wildcard .env),--env-file .env,)

serve: container
	mkdir -p $(DATA_DIR)
	docker run -it --init \
		--cap-add SYS_ADMIN \
		--security-opt seccomp=unconfined \
		--security-opt apparmor=unconfined \
		--security-opt systempaths=unconfined \
		-p 3000:3000 \
		-v $(DATA_DIR):/data \
		$(if $(wildcard .env),--env-file .env,) \
		ghcr.io/leanprover/lean-workbench:latest

dev: container
	mkdir -p $(DATA_DIR)
	docker run -it --init \
		--cap-add SYS_ADMIN \
		--security-opt seccomp=unconfined \
		--security-opt apparmor=unconfined \
		--security-opt systempaths=unconfined \
		-p 3000:3000 \
		-v $(DATA_DIR):/data \
		-e NODE_ENV \
		$(if $(wildcard .env),--env-file .env,) \
		ghcr.io/leanprover/lean-workbench:latest

enter: container
	mkdir -p $(DATA_DIR)
	docker run --rm -it \
		--cap-add SYS_ADMIN \
		--security-opt seccomp=unconfined \
		--security-opt apparmor=unconfined \
		--security-opt systempaths=unconfined \
		-v $(DATA_DIR):/data \
		--entrypoint bash \
		ghcr.io/leanprover/lean-workbench:latest
