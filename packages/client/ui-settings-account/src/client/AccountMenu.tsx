/** Sidebar account launcher and locally authoritative sign-out action. */
import { useEffect, useRef, useState } from 'react'
import {
  Toast, Menu, MenuItemButton, Tooltip, IconPaperPlaneOutlineMedium, IconPaperPlaneOutlineRegular,
  IconSettingsOutlineMedium, IconSettingsOutlineRegular, IconUserOutlineMedium,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime, PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import type { AccountSectionInjected } from './AccountSection.tsx'
import { SignOutDialog } from './SignOutDialog.tsx'
import { SignInDialog } from './SignInDialog.tsx'
import { LogoutIcon } from './LogoutIcon.tsx'
import { AccountNoticeStack } from './AccountNotice.tsx'
import { ContactDialog } from './ContactDialog.tsx'
import css from './AccountMenu.module.css'

/** Account launcher composed by the settings shell. */
export type AccountMenuProps = PropsRuntime<'settings.launcher'> & PropsLocale<'settings.account'> & InjectFace<AccountSectionInjected>
  & PropsRenderSlots<'settings.launcher.notifications'>

/** The signed-in label stays empty while the profile loads.
 * @param props - sidebar geometry, settings navigation and account operations.
 * @returns account menu launcher.
 */
export function AccountMenu({
  subscribeSessionExpired, subscribeModelSignInRequired, wide, settingsShortcut, openSettings, openOnboarding, settingsOpen,
  useAccount, useTheme, signOut, hasRunningAccountTasks, refreshAccount, bonusNoticeShown, bonusNoticeDismissed,
  feedbackDestination, contactUs, showLogin, start, cancel, t, renderSlot,
}: AccountMenuProps) {
  const anchor = useRef<HTMLDivElement>(null)
  // The launcher outlives the panel, so a false-to-true edge is one Settings entry:
  // re-renders, section switches and tab switches inside one open must not read again.
  const settingsWasOpen = useRef(false)
  useEffect(() => {
    if (settingsOpen && !settingsWasOpen.current) void refreshAccount()
    settingsWasOpen.current = settingsOpen
  }, [refreshAccount, settingsOpen])
  const account = useAccount(state => state)
  const colorScheme = useTheme(snapshot => snapshot.active.colorScheme)
  const signedIn = account.view?.status === 'credential-stored'
  const [signInNotice, setSignInNotice] = useState(0)
  useEffect(() => subscribeModelSignInRequired?.(() => { setSignInNotice(value => value + 1) }), [subscribeModelSignInRequired])
  const [expiryNotice, setExpiryNotice] = useState(false)
  useEffect(() => subscribeSessionExpired?.(() => { setExpiryNotice(true) }), [subscribeSessionExpired])
  const profile = account.details?.profile
  const label = profile === undefined ? null : profile.status === 'ready'
    ? profile.value.name ?? profile.value.contact ?? t('signedIn') : t('signedIn')
  const loginName = profile?.status === 'ready' ? profile.value.name?.trim() || profile.value.contact?.trim() : undefined
  const initial = Array.from(loginName ?? '')[0]
  const department = profile?.status === 'ready' ? profile.value.department?.trim() : undefined
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const [busy, setBusy] = useState(false)
  const [contactVisible, setContactVisible] = useState(false)
  const [signOutImpact, setSignOutImpact] = useState<boolean | 'unknown'>()
  const requestSignOut = async () => {
    setBusy(true)
    try { setSignOutImpact(await hasRunningAccountTasks()); setOpen(false) }
    catch (_error) { setSignOutImpact('unknown'); setOpen(false) }
    finally { setBusy(false) }
  }
  // The plugin's start publishes `loginFailed` before it rejects, so the dialog owns the report.
  const beginSignIn = (): void => { setOpen(false); void start().catch(() => undefined) }
  const openFeedback = (): void => {
    setOpen(false)
    if (feedbackDestination === 'internal-team') setContactVisible(true)
    else contactUs()
  }
  return <div ref={anchor} className={css.root}>
    {signInNotice > 0 && <Toast key={signInNotice} text={t('modelSignInRequired')} onDone={() => { setSignInNotice(0) }} />}
    {expiryNotice && <Toast text={t('sessionExpired')} onDone={() => { setExpiryNotice(false) }} />}
    {signedIn && !account.desktopOnboardingVisible && !account.onboarding && account.notices && <AccountNoticeStack
      notices={account.notices}
      anchor={anchor} title={t('bonusNoticeTitle')} closeLabel={t('close')}
      onShown={bonusNoticeShown} onDismiss={bonusNoticeDismissed} />}
    <Menu open={open} side="top" portal autoFocus className={css.anchor} listClassName={signedIn ? css.profileMenu : css.signedOutMenu}
      anchor={<Tooltip label={signedIn ? label ?? t('signedIn') : t('signIn')} side="top" disabled={open}>
        <button ref={trigger} type="button" className={css.trigger} data-signed-out={!signedIn} aria-label={t('menu')}
          aria-haspopup="menu" aria-expanded={open} onClick={() => { setOpen(value => !value) }}>
          <span aria-hidden="true">{signedIn && initial !== undefined ? initial : <IconUserOutlineMedium size={16} />}</span>
        </button>
      </Tooltip>} onClose={() => { setOpen(false) }}>
      {signedIn && <div className={css.profile}>
        <span className={css.profileAvatar} aria-hidden="true">{initial ?? <IconUserOutlineMedium size={16} />}</span>
        <div className={css.profileText}>
          <div className={css.profileName}>{label ?? t('signedIn')}</div>
          {department && <div className={css.department}>{department}</div>}
        </div>
      </div>}
      <MenuItemButton separatorBefore={signedIn} icon={<IconSettingsOutlineMedium size={16} />}
        shortcut={settingsShortcut} onSelect={() => { setOpen(false); trigger.current?.focus(); openSettings() }}>
        {t('settings')}
      </MenuItemButton>
      <MenuItemButton icon={<IconPaperPlaneOutlineMedium size={16} />} onSelect={openFeedback}>
        {t('contactUs')}
      </MenuItemButton>
      {signedIn ? <MenuItemButton icon={<LogoutIcon />} disabled={busy} onSelect={() => { void requestSignOut() }}>
        {t('signOut')}
      </MenuItemButton> : <MenuItemButton icon={<IconUserOutlineMedium size={16} />} onSelect={beginSignIn}>
        {t('signIn')}
      </MenuItemButton>}
    </Menu>
    {wide && <div className={css.footerActions}>
      {renderSlot('settings.launcher.notifications', {}, { fallback: <Tooltip label={t('notifications')} side="top">
        <button type="button" className={css.iconButton} aria-label={t('notifications')}>
          <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}
            strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M6.5 9.5a5.5 5.5 0 1 1 11 0c0 4.5 1.8 5.6 1.8 5.6H4.7s1.8-1.1 1.8-5.6M10 18.6a2 2 0 0 0 4 0" />
          </svg>
        </button>
      </Tooltip> })}
      <Tooltip label={t('contactUs')} side="top">
        <button type="button" className={css.iconButton} aria-label={t('contactUs')} onClick={openFeedback}>
          <IconPaperPlaneOutlineRegular size={15} />
        </button>
      </Tooltip>
      <Tooltip label={t('settings')} shortcutKeys={settingsShortcut?.keys} side="top">
        <button type="button" className={css.iconButton} aria-label={t('settings')}
          aria-keyshortcuts={settingsShortcut?.aria} aria-haspopup="dialog" aria-expanded={settingsOpen} onClick={openSettings}>
          <IconSettingsOutlineRegular size={15} />
        </button>
      </Tooltip>
    </div>}
    {contactVisible && <ContactDialog close={() => { setContactVisible(false) }} t={t} />}
    {account.loginVisible && !account.onboarding && <SignInDialog account={account} colorScheme={colorScheme}
      start={start} cancel={cancel} t={t}
      close={() => { showLogin(false) }} useApiKey={() => { showLogin(false); openOnboarding('deepseek-official') }} />}
    {signedIn && signOutImpact !== undefined && <SignOutDialog running={signOutImpact} signOut={signOut}
      close={() => { setSignOutImpact(undefined) }} t={t} />}
  </div>
}
