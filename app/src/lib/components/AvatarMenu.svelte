<script lang="ts">
  import authClient from '$lib/auth-client'
  import { resolve } from '$app/paths'
  import { goto } from '$app/navigation'
  import type { User } from '$lib/server/auth'
  
  const { user }: { user: User } = $props()

  async function handleLogout() {
    await authClient.signOut({
      fetchOptions: {
        onSuccess: async () => {
          await goto(resolve('/'))
        }
      }
    })
  }
</script>

{#if user.isAdmin}
  <span class="admin-badge">admin</span>
{/if}
<div class="avatar-menu">
  <button class="avatar-btn">
    {#if user.image}
      <img src={user.image} alt={user.name} />
    {:else}
      <span class="avatar-placeholder">{user.name[0].toUpperCase()}</span>
    {/if}
  </button>
  <div class="avatar-dropdown">
    <div class="avatar-dropdown-user">{user.name}</div>
    {#if user.isAdmin}
      <a href={resolve('/admin')}>Admin interface</a>
    {/if}
    <button onclick={handleLogout}>Logout</button>
  </div>
</div>
