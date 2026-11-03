/** Blocking IAM entry over the existing account flow; the Host remains the account authority. */
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { AccountSectionInjected } from './AccountSection.tsx'
import { OnboardingSurface } from './OnboardingSurface.tsx'
import { SignInDialog } from './SignInDialog.tsx'

type RequiredSignInInjected = Pick<AccountSectionInjected, 'hooks' | 'start' | 'cancel'>

const stayOnLogin = (): void => {}

/**
 * Hide and disable the workspace until the shared account stream confirms an IAM grant.
 * @param props - framework account/theme hooks and the existing sign-in and cancellation actions.
 * @returns a non-dismissible login dialog during loading, sign-out, expiry or non-IAM authentication.
 */
export function RequiredSignIn({ useAccount, useTheme, start, cancel, t }:
  PropsRuntime<'shell.overlay'> & PropsLocale<'settings.account'> & InjectFace<RequiredSignInInjected>) {
  const account = useAccount(value => value)
  const colorScheme = useTheme(value => value.active.colorScheme)
  if (account.view?.status === 'credential-stored' && account.view.authenticationMethod === 'iam') return null
  return <OnboardingSurface>
    <SignInDialog requiredIam account={account} colorScheme={colorScheme} start={start} cancel={cancel}
      close={stayOnLogin} useApiKey={stayOnLogin} t={t} />
  </OnboardingSurface>
}
