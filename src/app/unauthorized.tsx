import { AppLayout } from '@/app/components/AppLayout'
import { ErrorBox } from '@/app/components/ErrorBox'

export default function Unauthorized() {
  return (
    <AppLayout title='Unauthorized'>
      <ErrorBox>
        <p>You need to be signed in to access this page.</p>
      </ErrorBox>
    </AppLayout>
  )
}
