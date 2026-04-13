<script lang="ts">
  import { page } from '$app/state'
  import { resolve } from '$app/paths'
  import authClient from '$lib/auth-client'
  
  const session = authClient.useSession()
</script>

<h1>Lean Workbench</h1>
<p>Multi-user sandboxed VS Code server.</p><br/>

{#if $session.data}
  <div class="welcome">
    <h2>Welcome, {$session.data.user.name}</h2>
    <p><a href={resolve(`/${$session.data.user.name}`)}>Go to your profile</a></p>
  </div>
{:else}
  <h2>Sign in options</h2>
  {#if page.data.isGithubEnabled}
    <button class="login-link" onclick={() => authClient.signIn.social({ provider: 'github' })}>
      GitHub
    </button>
  {/if}
  {#if page.data.isDevMode}
    <form method="POST" action="?/devLogin" style="display: inline"><button class="login-link">Dev</button></form>
    <form method="POST" action="?/devAdminLogin" style="display: inline"><button class="login-link">Dev admin</button></form>
  {/if}
{/if}