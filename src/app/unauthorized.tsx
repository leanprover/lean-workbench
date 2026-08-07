import ErrorBox from './components/ErrorBox'

export default function Unauthorized() {
  return (
    <div>
      <h1>Unauthorized</h1>
      <ErrorBox>
        <p>You need to be signed in to access this page.</p>
      </ErrorBox>
    </div>
  )
}
