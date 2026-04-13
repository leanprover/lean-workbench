<script lang="ts">
  let { data } = $props<{
    data: {
      ownerUsername: string
      viewerUsername: string
      projectName: string
      isOwner: boolean
    }
  }>()

  let iframeSrc = $state('')
  let errorMsg = $state('')

  $effect(() => {
    document.body.classList.add('page-session')
    return () => document.body.classList.remove('page-session')
  })

  $effect(() => {
    iframeSrc = ''
    errorMsg = ''
    const encodedName = encodeURIComponent(data.projectName)
    fetch(`/api/editor-sessions/${data.ownerUsername}/${encodedName}`, { method: 'PUT' })
      .then(r => {
        if (!r.ok) throw new Error(r.statusText)
        return r.json() as Promise<{ iframeSrc: string }>
      })
      .then(d => {
        iframeSrc = d.iframeSrc
      })
      .catch((err: Error) => {
        errorMsg = `Failed to start editor session: ${err.message}`
      })
  })
</script>

<svelte:head>
  <title>{data.projectName} - Lean Workbench</title>
</svelte:head>

{#if errorMsg}
  <div class="error-banner">{errorMsg}</div>
{:else if iframeSrc}
  <iframe id="editor-frame" src={iframeSrc} title={data.projectName}></iframe>
{:else}
  <iframe id="editor-frame" title="Loading editor..."></iframe>
{/if}
