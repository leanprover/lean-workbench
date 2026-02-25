build:
	docker build -t podserver .

serve:
	mkdir -p /tmp/podserver-workspace
	docker run -it --init -p 3000:3000 -v /tmp/podserver-workspace:/home/workspace podserver:latest --default-folder /home/workspace
