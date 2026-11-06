window.__ModuleLoader__.load({
  id: '@fixture/title-prefix',
  factory(require) {
    const React = require('react')
    return {
      inject: ['slots'],
      apply(ctx) {
        let visible = false
        const listeners = new Set()
        const visibility = {
          getSnapshot: () => visible,
          subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener) },
        }
        const toggle = event => {
          visible = event.detail
          for (const listener of listeners) listener()
        }
        window.addEventListener('fixture-title-prefix', toggle)
        ctx.effect(() => () => window.removeEventListener('fixture-title-prefix', toggle))
        ctx.slots.inject('sidebar.session.row.leading', () => ctx.slots.register({
          name: 'sidebar.session.row.leading', id: 'fixture.leading',
        }, () => React.createElement('span', { 'data-fixture-leading': '', style: { width: 14, height: 14 } }, '◷')))
        for (const order of [1, 2]) {
          ctx.slots.inject('sidebar.session.title.prefix', () => ctx.slots.register({
            name: 'sidebar.session.title.prefix', id: `fixture.prefix.${order}`, order,
            inject: () => ({ hooks: { visible: visibility } }),
          }, ({ sessionId, useVisible }) => useVisible(value => value)
            ? React.createElement('span', {
                'data-fixture-prefix': order, 'data-session-id': sessionId,
                style: { display: 'inline-flex', width: 14, height: 14, lineHeight: '14px' },
              }, '●')
            : null))
        }
      },
    }
  },
})
