import { ErrorBox } from '@/app/components/ErrorBox'

export default function Forbidden() {
  return (
    <div>
      <h1>Not allowed</h1>
      <ErrorBox>
        <p>This account cannot access admin settings for Lean Workbench.</p>
      </ErrorBox>
    </div>
  )
}
