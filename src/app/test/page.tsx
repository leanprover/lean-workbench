'use client'

import { createProjectFromArchive } from '@/app/[userName]/actions'
import ErrorBox from '@/app/components/ErrorBox'
import { useServerAction } from '@/lib/client/util'

export default function TestPage() {
  const [testyError, testyAction, isPending] = useServerAction(createProjectFromArchive, () => {
    console.log('done')
  })

  return (
    <>
      <form action={testyAction}>
        <input name='archive' type='file' />
        <input name='nameSuggestion' type='hidden' value='new-projo' />
        <button type='submit' disabled={isPending}>
          Submit
        </button>
      </form>
      {testyError && <ErrorBox>{testyError}</ErrorBox>}
    </>
  )
}
