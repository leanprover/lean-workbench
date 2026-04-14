The Next.js convention is to store assets directly in `public/`.
However, hosting them under `static/` allows us to more easily recognize asset requests in `proxy.ts`.