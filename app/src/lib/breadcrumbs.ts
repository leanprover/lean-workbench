import { createContext, type Snippet } from "svelte";

export const [getBreadcrumbCtx, setBreadcrumbCtx] = createContext<(_: Snippet | null) => void>()

export function setBreadcrumbs(s: Snippet | null) {
    const fn = getBreadcrumbCtx()
    fn(s)
}