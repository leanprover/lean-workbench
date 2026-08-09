# Server best practices

- For server endpoints invoked by UI components,
  prefer React Server Functions to named API routes.
  Only use API routes for functionality that a Server Function cannot provide.
- Use Zod to validate input data and derive TypeScript types for it.
- Our deployment is one-machine; not serverless or CDN-based.
  Any warnings about shared globals can be safely ignored.
- Store global server state in `globalThis` instead of top-level variable bindings.
  This ensures state is preserved across HMR reloads.
  It's ok to re-export it, e.g. `export const foo = globalThis.__foo`.
- Prefer using server-generated unique IDs to user-provided names
  for identifying entities (users, projects, etc) internally.
  
# React best practices

- Prefer Server Components (RSCs) that do server-side computation and rendering in the same file
  to Client Components (RCCs) that invoke Server Functions/Actions.
  - But prefer fully client-side components when the associated Server Component
    is merely a very thin wrapper around the Client Component.
- Reduce the possible states of UI components by using algebraic sum types.
  For example, prefer one state of type `'loading' | { error: E } | { result: T }`
  to three states `[loading, setLoading] = useState(); [error, setError] = useState(); [result, setResult] = useState()`.
- For UI actions that hit the server,
prefer `useServerAction` (`@/lib/client/util`) or (if `useServerAction` doesn't work) `useActionState`
over manually storing response/error state with `useState`.
- To call Server Functions on mount (e.g. to fetch data), use SWR.

# Error handling

- Next.js interrupts are preferred when there is something appropriate available (e.g. authentication errors, forbidden())
- ActionResponse { error } states are only for failures the user is expected to be able to encounter during usual operation,
  and is expected to be able to act on (e.g. "A project with that name already exists").
- Everything else (bugs, unreachable services, misconfigured hosts) should throw to an error boundary.
- Errors thrown within the app should not be converted to ActionResponse errors, and vice versa.

Some details/consequences:

- Only render-phase throws hit error boundaries;
  exceptions originating from callbacks, event handlers, and timeouts must not be silently ignored.
  Next.js gives advice for handling these cases (https://nextjs.org/docs/app/getting-started/error-handling),
  generally we want to show the error to the user in the component
  or else re-raise to throw to an error boundary (`throwToBoundary` is useful here).
  (depending on whether it's user-actionable or not, as described above).
- SWR puts a fetcher's throw in `error`;
  use `useThrowingSWR` in the common case that this should be re-raised to an error boundary.
  Sometimes SWR errors should be shown to the user instead (use the primitive `useSWR` in these cases),
  but they should not be suppressed or ignored.
- Especially in administrative contexts, the expected/unexpected error distinction is blurry.
  Don't let the guidelines prevent an admin from seeing useful information in the web interface.

# Agent instructions

- Less code is better. After writing any new piece of code,
  review it to determine whether it could have been simpler and shorter.
- Omit implementation details that callers/users don't need to know from docstrings;
  leave them in comments inside the function/class/whatever body.
- Factor out string or path literal constructions that appear more than once into functions.
- Never remove comments that link to documentation,
  except when removing *all* of the associated code.
- Ignore `TODO`s and `FIXME`s in the codebase.
- Don't set `NODE_ENV` to anything besides `production`
  (https://nodejs.org/learn/getting-started/nodejs-the-difference-between-development-and-production).
- Prefer full CLI flag and command names in scripts. More self-documenting.
- Use semantic line breaks in docstrings (https://sembr.org/).
  
## Refactoring

- After moving code from an RCC to an RSC,
  some of the Server Actions previously invoked over the network by the RCC
  may now be possible to call directly in the RSC;
  if no other RCC still needs these Server Actions, move them to the RSC file.
  
## Git

- Don't commit or push, let the user do that. You can automate git worktree operations, though.
- When working on a significant change, i.e. one that involves a plan,
  make it in a suitably named branch, in a fresh worktree named branch-$BRANCHNAME.
  Clean up the worktree when done.
- Smaller changes can go into the working tree directly.