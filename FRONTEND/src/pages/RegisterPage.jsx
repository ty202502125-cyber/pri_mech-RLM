import { AuthPage } from './AuthPage'

export default function RegisterPage({ onSignedIn }) {
  return <AuthPage mode='register' onSignedIn={onSignedIn} />
}
