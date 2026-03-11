build:
	docker build -t podserver .

serve:
	mkdir -p /tmp/podserver
	docker run -it --init \
		--cap-add SYS_ADMIN \
		--security-opt seccomp=unconfined \
		--security-opt apparmor=unconfined \
		--security-opt systempaths=unconfined \
		-p 3000:3000 \
		-v /tmp/podserver:/data \
		$(if $(wildcard .env),--env-file .env,) \
		podserver:latest

dev:
	mkdir -p /tmp/podserver
	docker run -it --init \
		--cap-add SYS_ADMIN \
		--security-opt seccomp=unconfined \
		--security-opt apparmor=unconfined \
		--security-opt systempaths=unconfined \
		-p 3000:3000 \
		-v /tmp/podserver:/data \
		-e NODE_ENV=development \
		$(if $(wildcard .env),--env-file .env,) \
		podserver:latest

enter:
	docker run --rm -it \
		--cap-add SYS_ADMIN \
		--security-opt seccomp=unconfined \
		--security-opt apparmor=unconfined \
		--security-opt systempaths=unconfined \
		-v /tmp/podserver:/data \
		--entrypoint bash \
		podserver:latest
