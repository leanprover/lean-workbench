import ErrorBox from '@/app/components/ErrorBox'

export default function Forbidden() {
  return (
    <div>
      <h1>Not allowed</h1>
      <ErrorBox>
        <p>This account does not have admin access to Lean Workbench.</p>
      </ErrorBox>
    </div>
  )
}
