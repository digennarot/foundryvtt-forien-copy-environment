import {name, DEFAULT_UNSELECTED} from './config.js';
import Core from './core.js';

Hooks.once('init', function () {
  game.settings.register(name, 'selected-properties', {
    scope: 'client',
    config: false,
    type: Object,
    default: {...DEFAULT_UNSELECTED},
  });

  game.settings.register(name, 'diff-length', {
    scope: 'world',
    config: true,
    type: Number,
    default: 500,
    name: "forien-copy-environment.settings.max-diff",
    hint: "forien-copy-environment.settings.max-diff-hint",
    requiresReload: false,
  });
});

Hooks.once('devModeReady', ({registerPackageDebugFlag}) => {
  registerPackageDebugFlag(name);
});

Hooks.on('renderSettings', function (app, html, context, options) {
  // The application element persists across re-renders, so only attach the menu once.
  if (!options?.isFirstRender) {
    return;
  }

  new foundry.applications.ux.ContextMenu.implementation(html, 'section.info', [
    {
      label: 'forien-copy-environment.menu.copy',
      icon: '<i class="far fa-copy"></i>',
      onClick: async () => {
        try {
          await Core.copyAsText();
        } catch (e) {
          console.error('Copy Environment | Error copying game settings to clipboard', e);
        }
      },
    },
    {
      label: 'forien-copy-environment.menu.save',
      icon: '<i class="fas fa-copy"></i>',
      onClick: () => {
        try {
          Core.saveSummaryAsJSON();
        } catch (e) {
          console.error('Copy Environment | Error copying game settings to JSON', e);
        }
      },
    },
    {
      label: 'forien-copy-environment.menu.export',
      icon: '<i class="fas fa-file-export"></i>',
      onClick: () => {
        try {
          Core.exportGameSettings();
        } catch (e) {
          console.error('Copy Environment | Error exporting game settings', e);
        }
      },
    },
    {
      label: 'forien-copy-environment.menu.import',
      icon: '<i class="fas fa-file-import"></i>',
      onClick: () => {
        try {
          Core.importGameSettingsQuick();
        } catch (e) {
          console.error('Copy Environment | Error importing game settings', e);
        }
      },
    },
  ], {jQuery: false});
});
