<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Server best practices

- Do not store any state in JS module globals. Use `globalThis` instead.
- For endpoints invoked via UI, prefer writing React Server Functions to explicit API routes.
  Only use API routes for functionality that a Server Function cannot provide.
- Use Zod to validate input data and derive TypeScript types for it.