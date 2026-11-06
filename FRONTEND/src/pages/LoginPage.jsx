import { AuthPage } from './AuthPage'

export default function LoginPage({ onSignedIn }) {
  return <AuthPage mode='login' onSignedIn={onSignedIn} />
}
