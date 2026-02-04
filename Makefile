build:
	docker build -t podserver .

serve:
	docker run -it --init --cap-add SYS_ADMIN --security-opt seccomp=unconfined --security-opt apparmor=unconfined --security-opt systempaths=unconfined --env-file .env -p 3000:3000 -v /tmp/podserver-data:/data -v /tmp/podserver-workspaces:/home/workspace podserver:latest

dev:
	mkdir -p /tmp/podserver-data /tmp/podserver-nginx-routes
	cd client && npm run build
	node --experimental-strip-types spawner.ts
