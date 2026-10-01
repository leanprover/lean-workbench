This directory contains additional patches to VS Code
that we apply on top of the patches in `code-server/patches/`.
Each patch is `git diff` output generated in `code-server/`
against the version of https://github.com/coder/code-server
that is pinned as `CODE_SERVER_VERSION` in `Dockerfile`.

To create new patches, clone https://github.com/coder/code-server beside the `lean-workbench` folder in the filesystem and run the following commands.
These apply the relevant patches and create a baseline commit:

```sh
git clone https://github.com/coder/code-server
cd code-server

git checkout <the ref specified as CODE_SERVER_VERSION in the Dockerfile>
git submodule update --init
quilt push -a
for p in ../lean-workbench/code-server-patches/*.diff; do patch -p1 < "$p"; done
git -C lib/vscode add -A && git -C lib/vscode commit -m base
```

Then, after creating edits, create a new patch file,
which should have the filename `NNN-desc.diff` matching other files in this folder,
by running:

```sh
git -C lib/vscode diff --src-prefix=a/lib/vscode --dst-prefix=b/lib/vscode > new.diff
git diff -- . ':!lib/vscode' >> new.diff
mv new.diff ../lean-workbench/code-server-patches/<appropriate filename.diff>
```
