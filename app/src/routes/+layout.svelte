<script lang="ts">
  import '../app.css'
  import AvatarMenu from '$lib/components/AvatarMenu.svelte'
  import authClient from '$lib/auth-client'
  import { resolve } from '$app/paths'
  import { setBreadcrumbCtx } from '$lib/breadcrumbs.js'
  import type { Snippet } from 'svelte'

  const { children, data } = $props()

  let breadcrumbs: Snippet | null = $state(null)
  setBreadcrumbCtx(s => breadcrumbs = s)
  
  const session = authClient.useSession()
</script>

<svelte:head>
  <title>Lean Workbench</title>
</svelte:head>

<nav>
  <a class="logo" href={resolve('/')}>
    <img src="/lean-logo.svg" alt="Lean" class="logo-img" />
    <span class="logo-text">Lean Workbench</span>
  </a>
  {#if breadcrumbs}
    {@render breadcrumbs()}
  {/if}
  <span class="spacer"></span>
  {#if $session.data}
    <AvatarMenu user={$session.data?.user} />
  {:else if data.isSetupComplete && data.isGithubEnabled}
    <button class="nav-link" onclick={() => authClient.signIn.social({ provider: 'github' })}>Sign in via GitHub</button>
  {/if}
</nav>

<main style="max-width: 600px;">
  {@render children()}
</main>
