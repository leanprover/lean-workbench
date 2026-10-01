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

git checkout <'v' followed by the version specified as CODE_SERVER_VERSION in the Dockerfile>
git submodule update --init
quilt push -a
for p in ../lean-workbench/code-server-patches/*.diff; do patch -p1 < "$p" || exit 1; done
git -C lib/vscode add -A && git -C lib/vscode commit -m base
git add -A && git commit -m base
```

Then, edit files as needed, ensuring new files are tracked by running `git add --intent-to-add <filenames>`.
When the working tree contains all the changes you want to include in the patch,
create the patch file with a filename of the form `NNN-desc.diff` (matching other files in this folder):

```sh
git -C lib/vscode diff --src-prefix=a/lib/vscode/ --dst-prefix=b/lib/vscode/ > new.diff
git diff -- . ':!lib/vscode' >> new.diff
mv new.diff ../lean-workbench/code-server-patches/<appropriate filename.diff>
```
