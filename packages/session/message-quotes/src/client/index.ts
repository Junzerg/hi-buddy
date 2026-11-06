/** Quote selection actions and literal UserText excerpts registered by the browser plugin. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { TextInteractionSurface } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { QuoteSelectionAction } from './QuoteSelection.tsx'
import { QuotedUserText } from './QuotedUserText.tsx'
import { quoteRule } from './quote-rule.ts'
import { en, NS, zh, type MessageQuotesKey } from './locales.ts'

export type {} from './quote-rule.ts'

/** Live selection callbacks and the shared button style for additive actions. */
export interface QuoteSelectionActionOwnerProps extends TextInteractionSurface {
  /** Shared floating-action button style; preserve selection on pointer down. */
  readonly actionClassName: string
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** Additional actions beside Quote, bound to the selected text's Session. */
    'conversation.chat.text-interaction.quote.actions': {
      kind: 'list'
      scope: 'session'
      owner: QuoteSelectionActionOwnerProps
    }
  }
  interface LocaleNamespaceMap {
    /** Quote selection action copy. */
    messageQuotes: MessageQuotesKey
  }
}

/** Browser plugin name. */
export const name = 'message-quotes'

/** Services needed to admit selections and register Quote presentation. */
export const inject = ['slots', 'locale', 'sessions', 'uiConversation']

/**
 * Register Quote admission, its action surface, and literal UserText rendering.
 * @param ctx - Client root context owning every Quote contribution.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'message-quotes: dictionaries')
  ctx.effect(() => ctx.uiConversation.userText.register(quoteRule), 'message-quotes: UserText rule')
  ctx.effect(() => ctx.uiConversation.interactions.register({
    id: 'quote',
    onInteraction(request) {
      if (request.trigger !== 'selection' || request.readText() === null) return
      const binding = ctx.sessions.binding(request.sessionId)
      if (binding === undefined) return
      const session = binding.session.getSnapshot()
      if (session.removed || (session.subagent !== null
        && (session.subagent.address.mode !== 'continuable' || session.subagent.parentAvailable !== true))) return
      request.open()
    },
  }), 'message-quotes: selection interaction')
  ctx.slots.inject('conversation.chat.text-interaction', () => ctx.slots.register({
    name: 'conversation.chat.text-interaction', key: 'quote', locale: NS,
    children: {
      'conversation.chat.text-interaction.quote.actions': { kind: 'list', scope: 'session' },
    },
  }, QuoteSelectionAction))
  ctx.slots.inject('conversation.user.text.node', () => ctx.slots.register({
    name: 'conversation.user.text.node', key: 'quote', priority: 100,
  }, QuotedUserText))
}
