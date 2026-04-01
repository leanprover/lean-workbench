DATA_DIR ?= /tmp/lean-workbench

build:
	docker build -t ghcr.io/leanprover/lean-workbench:latest .

clean-install: build
	@test -n "$(DATA_DIR)" || { echo "ERROR: DATA_DIR is empty"; exit 1; }
	@test "$(realpath $(DATA_DIR) 2>/dev/null)" != "/" || { echo "ERROR: DATA_DIR resolves to /"; exit 1; }
	rm -rf $(DATA_DIR)
	./install.sh --no-pull --dir $(DATA_DIR) --port 3000 $(if $(wildcard .env),--env-file .env,)

serve:
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

dev:
	mkdir -p $(DATA_DIR)
	docker run -it --init \
		--cap-add SYS_ADMIN \
		--security-opt seccomp=unconfined \
		--security-opt apparmor=unconfined \
		--security-opt systempaths=unconfined \
		-p 3000:3000 \
		-v $(DATA_DIR):/data \
		-e NODE_ENV=development \
		$(if $(wildcard .env),--env-file .env,) \
		ghcr.io/leanprover/lean-workbench:latest

enter:
	docker run --rm -it \
		--cap-add SYS_ADMIN \
		--security-opt seccomp=unconfined \
		--security-opt apparmor=unconfined \
		--security-opt systempaths=unconfined \
		-v $(DATA_DIR):/data \
		--entrypoint bash \
		ghcr.io/leanprover/lean-workbench:latest
