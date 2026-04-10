<script lang="ts">
  let { children } = $props()
</script>

<svelte:head>
  <title>Lean Workbench</title>
</svelte:head>

{@render children()}
