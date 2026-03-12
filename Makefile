build:
	docker build -t ghcr.io/leanprover/lean-workbench:latest .

clean-install: build
	sudo rm -rf /tmp/lean-workbench
	./install.sh --no-pull --dir /tmp/lean-workbench --port 3000 $(if $(wildcard .env),--env-file .env,)

serve:
	mkdir -p /tmp/lean-workbench
	docker run -it --init \
		--cap-add SYS_ADMIN \
		--security-opt seccomp=unconfined \
		--security-opt apparmor=unconfined \
		--security-opt systempaths=unconfined \
		-p 3000:3000 \
		-v /tmp/lean-workbench:/data \
		$(if $(wildcard .env),--env-file .env,) \
		ghcr.io/leanprover/lean-workbench:latest

dev:
	mkdir -p /tmp/lean-workbench
	docker run -it --init \
		--cap-add SYS_ADMIN \
		--security-opt seccomp=unconfined \
		--security-opt apparmor=unconfined \
		--security-opt systempaths=unconfined \
		-p 3000:3000 \
		-v /tmp/lean-workbench:/data \
		-e NODE_ENV=development \
		$(if $(wildcard .env),--env-file .env,) \
		ghcr.io/leanprover/lean-workbench:latest

enter:
	docker run --rm -it \
		--cap-add SYS_ADMIN \
		--security-opt seccomp=unconfined \
		--security-opt apparmor=unconfined \
		--security-opt systempaths=unconfined \
		-v /tmp/lean-workbench:/data \
		--entrypoint bash \
		ghcr.io/leanprover/lean-workbench:latest
