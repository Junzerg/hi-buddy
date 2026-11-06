/** Quote action rendered through the Chat text-interaction Slot. */
import { useEffect } from 'react'
import type { PropsLocale, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './QuoteSelection.module.css'

/**
 * Render the action for a selection admitted by the Quote plugin.
 * @param props - area-local text interaction and standard Session/composer seats.
 * @returns Quote and registered extension actions for a writable conversation.
 */
export function QuoteSelectionAction({ trigger, dismiss, readText, clearSelection, inputActions, useSession, t, renderSlot }:
PropsRuntime<'conversation.chat.text-interaction'> & PropsLocale<'messageQuotes'>
& PropsRenderSlots<'conversation.chat.text-interaction.quote.actions'>) {
  const enabled = useSession(s => !s.removed && (s.subagent === null
    || (s.subagent.address.mode === 'continuable' && s.subagent.parentAvailable === true)))
  useEffect(() => {
    if (!enabled) dismiss()
  }, [enabled, dismiss])
  if (!enabled) return null
  return <div className={css.actions}>
    <button type="button" className={css.action} aria-label={t('quote.add')}
      onPointerDown={(event) => { event.preventDefault() }}
      onClick={() => {
        const text = readText()
        if (text === null) { dismiss(); return }
        if (!inputActions.insertQuote(text)) return
        clearSelection()
        dismiss()
      }}>{t('quote.add')}</button>
    {renderSlot('conversation.chat.text-interaction.quote.actions', {
      trigger, dismiss, readText, clearSelection, actionClassName: css.action ?? '',
    })}
  </div>
}
