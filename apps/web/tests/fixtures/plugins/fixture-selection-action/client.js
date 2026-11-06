window.__ModuleLoader__.load({
  id: '@fixture/selection-action',
  factory(require) {
    const React = require('react')
    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('conversation.chat.text-interaction.quote.actions', () => ctx.slots.register({
          name: 'conversation.chat.text-interaction.quote.actions', id: 'fixture.capture',
        }, ({ sessionId, readText, dismiss, clearSelection, actionClassName }) => React.createElement('button', {
          type: 'button', className: actionClassName,
          onPointerDown: event => event.preventDefault(),
          onClick: () => {
            const text = readText()
            if (text !== null) document.documentElement.dataset.selectionCapture = JSON.stringify({ sessionId, text })
            clearSelection()
            dismiss()
          },
        }, 'Capture selection')))
      },
    }
  },
})
