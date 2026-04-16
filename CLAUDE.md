## useful documents

in `branch-main/plans/`. Check the 'status:' field if present in the first few lines to see whether it's still relevant.

## ignore

TODO - informal notes that should not be given much weight

## git operations

Don't do git commits or pushes, let the user do them. You can automate
git worktree operations, though.

## git worktrees

When working on a significant change, i.e. one that involves a plan,
make it in a suitably named branch, in a fresh worktree, named
branch-$BRANCHNAME. Clean up the worktree when done.

Smaller changes can go on `branch-main`.