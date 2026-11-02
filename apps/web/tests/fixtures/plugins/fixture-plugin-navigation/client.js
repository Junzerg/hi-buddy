/** Test-only control using the real panel's public navigation service. */
window.__ModuleLoader__.load({
  id: '@fixture/plugin-navigation',
  factory(require) {
    const React = require('react')
    return {
      inject: ['slots', 'pluginNavigation'],
      apply(ctx) {
        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay', id: 'fixture.plugin-navigation', locale: 'pluginManager',
          inject: () => ({ openPlugins: () => ctx.pluginNavigation.openList() }),
        }, ({ t, openPlugins }) => React.createElement('button', {
          type: 'button', 'data-plugin-panel-test-entry': '', onClick: openPlugins,
          style: { position: 'fixed', right: 4, bottom: 4, zIndex: 1000 },
        }, t('title'))))
      },
    }
  },
})
