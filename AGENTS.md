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
- RSCs must call `await io()` before accessing server state (`getConfig`, `getAuth`, etc),
  unless they have already used a request-time API (`cookies`, `params`, etc).
- We've set Next.js [cacheComponents](https://nextjs.org/docs/app/api-reference/config/next-config-js/cacheComponents) to `true`
  in order to *turn off* caching of SSR responses.
  Without `cacheComponents`, caching is the opt-out default.
  We are not currently using the opt-in caching (`"use cache"`).
- [Non-instant navigations](https://nextjs.org/docs/app/guides/instant-navigation) (e.g. ones that read server state and thus `await io()`)
  trigger the [uncached data insight](https://nextjs.org/docs/messages/blocking-prerender-dynamic) in Next.js.
  This is expected - opt segments out with `export const instant = false`,
  or add a `loading.tsx` page if it surfaces useful information (rather than just 'Loading..').
  Never silence this insight by dropping `await io()`.
  - Client-side navigations only re-render below the shared layout,
    so a `Suspense` boundary in the layout does not make such navigations instant.

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

## Directory structure

- Imports may refer to relative paths like `./actions` and `./SomeComponent`,
  but imports like `../actions` or `../components/SomeComponent` are not permitted.
- Absolute imports starting with `@/app/components` are allowed;
  no other imports starting with `@/app` are allowed.
  (Example: `import { ErrorBox } from '@/app/components/ErrorBox'` is allowed,
  `import { AdminErrorBox } from '@/app/components/admin/AdminErrorBox'` is allowed,
  `import { SetupErrorBox } from '@/app/setup/SetupErrorBox'` is not allowed.)

Actions will naturally start out in `actions.ts` files alongside the `page.tsx` file where they are used,
and components will naturally start out in `MyComponent.tsx` files alongside the `page.tsx` files where they are used;
however, as a consequence of these rules,
when the functionality is needed in a second location, actions or components may need to migrate to a new location.
Gathering components for a route into a subfolder (e.g. `./src/app/(settings)/admin/components`)
may also require actions to migrate into the `./src/lib` tree.

- Functionality that is used in multiple places goes in `./src/app/components` and its subfolders (for `.tsx` files)
  and in `./src/lib` and its subfolders (for server actions and other non-component `.ts` code).
- Most `.tsx` files that aren't a part of Next's routing should principally introduce a component,
  along with hooks and helpers for that component.
- A file principally introducing the `ErrorBox` component should be named `ErrorBox.tsx`.
- Default exports should only be used where expected by Next.js.
  A component `ErrorBox` should be exported as a non-default export in `ErrorBox.tsx`.

## Linting

- Autofixable problems should generally be `warn`, not `error`:
  errors indicate only problems that aren't deterministically addressed by the pre-commit hook.

## Git

- Don't commit or push, let the user do that. You can automate git worktree operations, though.
- When working on a significant change, i.e. one that involves a plan,
  make it in a suitably named branch, in a fresh worktree named branch-$BRANCHNAME.
  Clean up the worktree when done.
- Smaller changes can go into the working tree directly.