build:
	docker build -t podserver .

serve:
	docker run -it --init --cap-add SYS_ADMIN --security-opt seccomp=unconfined --security-opt apparmor=unconfined --security-opt systempaths=unconfined --env-file .env -p 3000:3000 -v /tmp/podserver-data:/data -v /tmp/podserver-workspaces:/home/workspace -v /tmp/podserver-elan:/home/elan-volume podserver:latest

dev:
	mkdir -p /tmp/podserver-data /tmp/podserver-nginx-routes /tmp/podserver-elan
	cd client && npm run build
	DB_PATH=/tmp/podserver-data/podserver.db WORKSPACE_BASE=/tmp/podserver-workspaces NGINX_ROUTES_DIR=/tmp/podserver-nginx-routes ELAN_BASE=/tmp/podserver-elan node --experimental-strip-types spawner.ts
