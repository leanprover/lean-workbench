import { AppLayout } from '@/app/components/AppLayout'
import { ErrorBox } from '@/app/components/ErrorBox'

export default function Forbidden() {
  return (
    <AppLayout title='Not allowed'>
      <ErrorBox>
        <p>You don&apos;t have access to this page.</p>
      </ErrorBox>
    </AppLayout>
  )
}
