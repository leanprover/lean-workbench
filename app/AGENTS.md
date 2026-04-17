<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Server best practices

- Do not store any state in JS module globals. Use `globalThis` instead.
- For endpoints invoked via UI, prefer writing React Server Functions to explicit API routes.
  Only use API routes for functionality that a Server Function cannot provide.
- Use Zod to validate input data and derive TypeScript types for it.
- Our deployment is purely local, one-machine; not serverless or CDN-based.
  Warnings about shared globals can be safely ignored.
- Whenever possible,
  prefer Server Components that do server-side computation and rendering in the same file
  to Client Components that invoke Server Functions/Actions.
- For UI actions that hit the server,
  prefer `useServerAction` (`@/lib/util`) or (if `useServerAction` doesn't work) `useActionState`
  over manually storing response/error state with `useState`.
- To call Server Functions on mount, use SWR.
  
# Agent instructions

- Less code is better. After writing any new piece of code,
  review it to determine whether it could have been simpler and shorter.
- Never remove comments that link to documentation,
  except when removing *all* of the associated code.