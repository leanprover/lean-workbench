<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Server best practices

- Do not store any state in JS module globals. Use `globalThis` instead.
- For endpoints invoked via UI, prefer writing React Server Functions to explicit API routes.
  Only use API routes for functionality that a Server Function cannot provide.
- Use Zod to validate input data and derive TypeScript types for it.
- Our deployment is one-machine; not serverless or CDN-based.
  Hence warnings about shared globals can be safely ignored.
- Whenever it simplifies the implementation,
  Prefer Server Components that do server-side computation and rendering in the same file
  to Client Components that invoke Server Functions/Actions.
- Reduce the possible states of UI components by using algebraic sum types.
  For example, prefer one state of type `'loading' | { error: E } | { result: T }`
  to `[loading, setLoading] = useState(); [error, setError] = useState(); [result, setResult] = useState()`.
  - As one case of this principle,
    for UI actions that hit the server,
    prefer `useServerAction` (`@/lib/util`) or (if `useServerAction` doesn't work) `useActionState`
    over manually storing response/error state with `useState`.
- To call Server Functions on mount (e.g. to fetch data), use SWR.
  
# Agent instructions

- Less code is better. After writing any new piece of code,
  review it to determine whether it could have been simpler and shorter.
- Never remove comments that link to documentation,
  except when removing *all* of the associated code.
- Ignore `TODO`s and `FIXME`s in the codebase.
  
## Refactoring

- After moving code from an RCC to an RSC,
  some of the Server Actions previously invoked over the network by the RCC
  may now be possible to call directly in the RSC;
  move them to the RSC file in this case.
  
## Git

- Don't commit or push, let the user do that. You can automate git worktree operations, though.
- When working on a significant change, i.e. one that involves a plan,
  make it in a suitably named branch, in a fresh worktree named branch-$BRANCHNAME.
  Clean up the worktree when done.
- Smaller changes can go into the working tree directly.