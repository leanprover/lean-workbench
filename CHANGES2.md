Here are some changes I'd like to implement:

- **Lean logo SVG** — use `/static/lean-logo.svg`, as old-version does.
- **Google Fonts** — use Open Sans from Google Fonts, as old-version does.
- **`GET /api/health`** — implement a simple health check, as old-version does.
- **API error format** — return JSON `{ error: "..." }` objects as errors, as old-version does, instead of plain text.
- **port polling** — use a 1000ms interval for `waitForPort` instead of 200ms.
