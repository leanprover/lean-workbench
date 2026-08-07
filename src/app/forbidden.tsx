import ErrorBox from './components/ErrorBox'

export default function Forbidden() {
  return (
    <div>
      <h1>Not allowed</h1>
      <ErrorBox>
        <p>You don&apos;t have access to this page.</p>
      </ErrorBox>
    </div>
  )
}
