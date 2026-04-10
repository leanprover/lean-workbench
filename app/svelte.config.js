import adapter from '@sveltejs/adapter-node'

/** @type {import('@sveltejs/kit').Config} */
const config = {
  compilerOptions: {
    // Force [runes mode](https://svelte.dev/docs/svelte/what-are-runes) for the project, except for libraries.
    // Can be removed in svelte 6.
    runes: ({ filename }) => (filename.split(/[/\\]/).includes('node_modules') ? undefined : true),
  },
  kit: {
    // https://svelte.dev/docs/kit/adapter-node
    adapter: adapter(),
  },
}

export default config
