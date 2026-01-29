build:
	docker build -t podserver .

serve:
	docker run -it --init --cap-add SYS_ADMIN --security-opt seccomp=unconfined -p 3000:3000 podserver:latest
