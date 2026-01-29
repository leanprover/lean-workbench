# podserver

Experiments towards getting vscode running in the browser

## Experiment 1

Directly use `gitpod/openvscode-server:latest` with preinstalled extension, elan not yet preinstalled:

```
cd extension
docker build -t podserver .
docker run -it --init -p 3000:3000 -v "/tmp/workspace4:/home/workspace:cached"  podserver:latest --extensions-dir /home/openvscode-server/extensions
```

current result: seems to work ok

## Experiment 2

Try to build vscode from scratch

```
cd manual
docker build -t podserver .
docker run -it --init -p 3000:3000 podserver:latest
```

current result: server exists, and serves some html file, but interface does not load

## Experiment 3

Try to use gitpod's release of openvscode-server.

```
cd rebuild
docker build -t podserver .
docker run -it --init -p 3000:3000 podserver:latest
```

other manual entry points:
```
docker run -it --init -p 3000:3000 -v "/tmp/workspace4:/home/workspace:cached"  podserver:latest --extensions-dir /home/openvscode-server/extensions
docker run -it --init --entrypoint /bin/bash  podserver:latest
```
