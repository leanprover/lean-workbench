build:
	docker build -t podserver .

serve:
	mkdir -p /tmp/podserver-workspace
	docker run -it --init --cap-add SYS_ADMIN --security-opt seccomp=unconfined --security-opt apparmor=unconfined --security-opt systempaths=unconfined -p 3000:3000 -v /tmp/podserver-workspace:/home/workspace podserver:latest
