import { name, templates, log, DEFAULT_UNSELECTED, DEPRECATED_SETTINGS } from './config.js';
import Setting, { getSettingSource } from './setting.js';

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export default class Core extends HandlebarsApplicationMixin(ApplicationV2) {
  /**
   * @param {Array.<Object>} settings Read from previously exported settings
   */
  constructor(settings, options = {}) {
    // Size relative to the viewport at the time the window is opened.
    super(foundry.utils.mergeObject({ position: { width: Math.ceil(window.innerWidth / 2) } }, options));
    this.importing = false;
    this.settingGroups = new Map();
    this.settings = [];
    this.hasWorldSettings = false;
    this.playerSettings = [];
    this.hasPlayerSettings = false;
    this.notChangedSettings = [];
    this.notChangedPlayers = [];
    this.notFoundPlayers = [];
    this.selectedProperties = {
      ...DEFAULT_UNSELECTED,
      ...(game.settings.get(name, 'selected-properties') || {}),
    };
    this.supportingData = {};

    if (settings && Array.isArray(settings)) {
      log(true, 'Parsing provided settings', settings);

      settings.forEach((data) => {
        if (DEPRECATED_SETTINGS.includes(data?.key)) {
          log(false, 'Skipping deprecated setting', data.key);
          return;
        }
        try {
          let setting = new Setting(data);
          if (setting) {
            switch (setting.type) {
              case Setting.WorldType:
                if (setting.hasChanges()) {
                  if (!this.settingGroups.has(setting.value.group)) {
                    this.settingGroups.set(setting.value.group, []);
                  }
                  this.settingGroups.get(setting.value.group).push(setting.value);
                  if (typeof this.selectedProperties[setting.value.key] === 'undefined') {
                    this.selectedProperties[setting.value.key] = true;
                  }
                  this.hasWorldSettings = true;
                } else {
                  this.notChangedSettings.push(setting.data.key);
                }
                break;
              case Setting.PlayerType:
                if (!setting.hasChanges()) {
                  this.notChangedPlayers.push(setting.data.name);
                  break;
                }
                if (setting.value.playerNotFound) {
                  this.notFoundPlayers.push(setting.value);
                  break;
                }
                for (const key of Object.keys(setting.value.playerDifferences)) {
                  const combinedKey = `${setting.value.name}--${key}`;
                  if (typeof this.selectedProperties[combinedKey] === 'undefined') {
                    this.selectedProperties[combinedKey] = true;
                  }
                }
                for (const key of Object.keys(setting.value.playerFlagDifferences)) {
                  const combinedKey = `${setting.value.name}--flag--${key}`;
                  if (typeof this.selectedProperties[combinedKey] === 'undefined') {
                    this.selectedProperties[combinedKey] = true;
                  }
                }
                this.playerSettings.push(setting.value);
                this.hasPlayerSettings = true;
                break;
              case Setting.SupportingDataType:
                // Merge setting value with existing support data
                this.supportingData = foundry.utils.mergeObject(this.supportingData, setting.value);
                break;
              default:
                throw new Error(`Unknown setting type: ${setting.type}`);
            }
          }
        } catch (e) {
          console.error('Copy Environment |', 'Error importing setting:', data, e);
        }
      });
    }

    this.settings = Object.entries(Object.fromEntries(this.settingGroups));
    this.settings.sort((a, b) => a[0].localeCompare(b[0]));
    for (const playerSetting of this.playerSettings) {
      playerSetting.playerDifferences = Object.entries(playerSetting.playerDifferences);
      playerSetting.playerDifferences.sort((a, b) => a[0].localeCompare(b[0]));
      playerSetting.playerFlagDifferences = Object.entries(playerSetting.playerFlagDifferences);
      playerSetting.playerFlagDifferences.sort((a, b) => a[0].localeCompare(b[0]));
    }

    log(true, 'Processing world settings', this.settings);
    log(true, 'Processing player settings', this.playerSettings);
    log(true, 'Selected Properties', this.selectedProperties);
  }

  static DEFAULT_OPTIONS = {
    id: `${name}-settings`,
    classes: ['copy-environment-settings'],
    window: {
      title: `${name}.title`,
      resizable: true,
    },
    position: {
      height: 'auto',
    },
    actions: {
      import: Core.#onImport,
      showSettings: Core.#onShowSettings,
    },
  };

  static PARTS = {
    form: {
      template: templates.settings,
      scrollable: ['.import-properties'],
    },
  };

  /**
   * The form element rendered by the template.
   * @type {HTMLFormElement|null}
   */
  get form() {
    return this.element?.querySelector('form') ?? null;
  }

  // shouldShowCoreModuleWarning returns true if the core module configuration is not selected.
  shouldShowCoreModuleWarning() {
    return !this.selectedProperties['core.moduleConfiguration'];
  }

  async _prepareContext(options) {
    return {
      settings: this.settings,
      playerSettings: this.playerSettings,
      hasWorldSettings: this.hasWorldSettings,
      hasPlayerSettings: this.hasPlayerSettings,
      hasChanges: this.hasWorldSettings || this.hasPlayerSettings,
      notChangedSettings: this.notChangedSettings,
      notChangedPlayers: this.notChangedPlayers,
      notFoundPlayers: this.notFoundPlayers,
      selectedProperties: this.selectedProperties,
      shouldShowCoreModuleWarning: this.shouldShowCoreModuleWarning(),
    };
  }

  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    this.element.addEventListener('change', this.#onChangeCheckbox.bind(this));
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    this.element.querySelectorAll('tbody').forEach((tbody) => {
      const first = tbody.querySelector('input[type=checkbox]');
      if (first) {
        this.#updateCheckboxStates(first);
      }
    });
  }

  /**
   * Sync the "select all" checkbox of a group with the state of its options.
   * @param {HTMLInputElement} el
   */
  #updateCheckboxStates(el) {
    let overall = el.closest('tbody')?.querySelector('input[type=checkbox].toggle-selections');
    if (el.dataset?.type === 'core' || el.dataset?.type === 'flag') {
      overall = el.closest('fieldset')?.querySelector('input[type=checkbox].toggle-selections');
    }

    if (!overall) {
      return;
    }

    const options = Array.from(
      el.closest('tbody').querySelectorAll('input[type=checkbox]:not(.toggle-selections)')
    );
    const checkedCount = options.filter((o) => o.checked).length;

    overall.checked = options.length > 0 && checkedCount === options.length;
    overall.indeterminate = checkedCount > 0 && checkedCount < options.length;
  }

  /**
   * Set the checked state of several checkboxes, persisting the selection once.
   * @param {HTMLInputElement[]} inputs
   * @param {boolean} checked
   */
  #setChecked(inputs, checked) {
    for (const input of inputs) {
      input.checked = checked;
      input.indeterminate = false;
      if (input.name) {
        this.selectedProperties[input.name] = checked;
      }
    }
    this.#persistSelection();
    this.element.querySelectorAll('tbody').forEach((tbody) => {
      const first = tbody.querySelector('input[type=checkbox]:not(.toggle-selections)');
      if (first) {
        this.#updateCheckboxStates(first);
      }
    });
  }

  #persistSelection() {
    game.settings.set(name, 'selected-properties', this.selectedProperties);
    this.element
      .querySelector('.core-module-warning')
      ?.classList.toggle('hidden', !this.shouldShowCoreModuleWarning());
  }

  #onChangeCheckbox(event) {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || target.type !== 'checkbox') {
      return;
    }

    if (target.classList.contains('toggle-all-selections')) {
      const inputs = Array.from(target.closest('fieldset').querySelectorAll('td input[type=checkbox]'));
      this.#setChecked(inputs, target.checked);
      return;
    }

    if (target.classList.contains('toggle-selections')) {
      // World groups have their toggle inside the tbody, player fieldsets have it in the thead.
      const scope = target.closest('tbody') ?? target.closest('fieldset');
      const inputs = Array.from(scope.querySelectorAll('td input[type=checkbox]')).filter((i) => i !== target);
      this.#setChecked(inputs, target.checked);
      return;
    }

    if (!target.name) {
      return;
    }

    log(false, `Setting ${target.name} to ${target.checked}`);
    this.selectedProperties[target.name] = target.checked;
    this.#persistSelection();
    this.#updateCheckboxStates(target);
  }

  static #onShowSettings(event, target) {
    const row = target.closest('tr');
    target.closest('tbody').querySelectorAll('tr').forEach((tr) => {
      if (tr !== row) {
        tr.classList.toggle('none');
      }
    });
  }

  static async #onImport(event, target) {
    if (this.importing) {
      return;
    }
    this.importing = true;
    target.disabled = true;
    try {
      await this.#import();
    } finally {
      this.importing = false;
      target.disabled = false;
    }
  }

  async #import() {
    let changed = false;
    const fieldsets = Array.from(this.form.getElementsByTagName('fieldset'))
      .sort((f) => (f.dataset?.type === 'player' ? -1 : 1));
    for (let field of fieldsets) {
      let targetType = field.dataset?.type;
      if (!targetType) {
        log(false, 'Could not find fieldset target type');
        continue;
      }

      switch (targetType) {
        case 'world':
          changed = (await this.importWorldSettings(field)) || changed;
          break;
        case 'player':
          changed = (await this.importPlayerSettings(field)) || changed;
          break;
      }
    }

    if (changed) {
      ui.notifications.info(game.i18n.localize('forien-copy-environment.updatedReloading'), { permanent: true });
      window.setTimeout(() => foundry.utils.debouncedReload(), 6000);
    }

    this.close();
  }

  async importWorldSettings(fieldset) {
    let changes = [];
    for (let input of fieldset.elements) {
      if (!input.checked || !input.name) {
        continue;
      }

      const target = input.dataset?.for;
      if (!target) {
        continue;
      }

      const [group, val] = target.split('--');
      if (!this.settings[group] || !this.settings[group][1] || !this.settings[group][1][val]) {
        log(false, 'Import world settings: could not find target for', input);
        continue;
      }

      log(false, 'Importing world setting', this.settings[group][1][val]);
      changes.push(this.settings[group][1][val]);
    }
    if (!changes.length) {
      return false;
    }

    try {
      return (await this.processSettings(changes)) === true;
    } catch (e) {
      console.error('Import world settings: error', e);
      return false;
    }
  }

  async importPlayerSettings(fieldset) {
    let targetUser = null;
    let changes = {
      flags: {},
    };
    for (let input of fieldset.elements) {
      if (!input.checked || !input.name) {
        continue;
      }

      let target = input.dataset?.for;
      if (!this.playerSettings[target]) {
        log(true, 'Import player settings: could not find target for', input);
        continue;
      }

      let type = input.dataset?.type;
      if (!type) {
        log(true, 'Import player settings: missing type (core or flag)');
        continue;
      }

      if (!targetUser) {
        targetUser = game.users.getName(this.playerSettings[target].name);
      }

      const fieldName = input.name.split('--').pop();

      if (type === 'core') {
        changes[fieldName] =
          Object.fromEntries(this.playerSettings[target].playerDifferences)[fieldName].newVal;
      }

      if (type === 'flag') {
        changes.flags[fieldName] =
          Object.fromEntries(this.playerSettings[target].playerFlagDifferences)[fieldName].newVal;
      }
    }

    if (!targetUser) {
      log(true, 'No targetUser found.');
      return false;
    }

    if (Object.keys(changes).length === 1 && foundry.utils.isEmpty(changes.flags)) {
      log(true, 'No changes selected for', targetUser?.name);
      return false;
    }

    log(true, `Updating ${targetUser.name} with`, changes);
    await targetUser.update(changes);

    ui.notifications.info(
      game.i18n.format('forien-copy-environment.import.updatedPlayer', {
        name: targetUser.name,
      })
    );

    return true;
  }

  static download(data, filename) {
    if (!filename) {
      log(false, 'Missing filename on download request');
      return;
    }

    let jsonStr = JSON.stringify(data, null, 2);

    foundry.utils.saveDataToFile(jsonStr, 'application/json', filename);
  }

  static getAuthors(pkg) {
    const authors = pkg.authors?.size || pkg.authors?.length
      ? Array.from(pkg.authors).map((a) => (typeof a === 'string' ? a : a.name))
      : [pkg.author];
    return Array.from(new Set(authors.filter(Boolean))).join(', ');
  }

  static getText() {
    const system = game.system;
    const core = game.version;

    let text = `Core Version: ${core}\n\n`;

    text += `System: ${system.id} ${system.version} (${Core.getAuthors(system)}) \n\n`;

    text += `Modules: \n`;
    Core.getModulesForExport().forEach((m) => {
      text += `${m.id ?? m.name} ${m.version} (${Core.getAuthors(m)})\n`;
    });

    text += `\n${game.i18n.localize('forien-copy-environment.message')}`;

    log(true, text);

    return text;
  }

  static async copyAsText() {
    const text = this.getText();

    await game.clipboard.copyPlainText(text);

    ui.notifications.info(game.i18n.localize('forien-copy-environment.copiedToClipboard'));
  }

  static getModulesForExport() {
    return game.modules.filter((m) => m.active).map((m) => {
      let mod = m.toObject();
      mod.active = m.active;
      return mod;
    });
  }

  static saveSummaryAsJSON() {
    const system = game.system;

    const data = {};
    data.core = {
      version: game.version,
    };
    data.system = {
      id: system.id,
      version: system.version,
      author: Core.getAuthors(system),
      manifest: system.manifest,
    };
    data.modules = Core.getModulesForExport().map((m) => ({
      id: m.id || m.name,
      version: m.version,
      author: Core.getAuthors(m),
      manifest: m.manifest,
    }));

    this.download(data, Core.getFilename('foundry-environment'));
  }

  static exportGameSettings() {
    const excludeModules = game.modules
      .filter((m) => m.flags?.noCopyEnvironmentSettings)
      .map((m) => m.id);

    // Return an array with both the world settings and player settings along with their support data.
    let data = Array.prototype.concat(
      Array.from(game.settings.settings)
        .filter(([k, v]) => {
          if (DEPRECATED_SETTINGS.includes(k)) {
            return false;
          }
          try {
            const value = game.settings.get(v.namespace, v.key);
            let sameValue = value === v.default;
            if (value && typeof value === 'object' && v.default && typeof v.default === 'object') {
              sameValue = !Object.keys(foundry.utils.diffObject(v.default, value)).length && !Object.keys(foundry.utils.diffObject(value, v.default)).length;
            }
            return !sameValue && !excludeModules.some((e) => v.namespace === e);
          } catch (e) {
            console.error(`Copy Environment | Could not export settings for ${v.namespace}.${v.key} due to an error. Please report this as an issue on GitHub.`, e);
            return false;
          }
        })
        .map(([k, v]) => ({
          key: k,
          value: getSettingSource(v.namespace, v.key),
        }))
        .sort((a, b) => a.key.localeCompare(b.key)),
      game.users.map((user) => {
        return {
          name: user.name,
          core: {
            avatar: user._source.avatar,
            color: user._source.color,
            permissions: user._source.permissions,
            role: user._source.role,
          },
          flags: user._source.flags,
        };
      }),
      [
        {
          type: Setting.SupportingDataType,
          value: {
            compendiumFolders: game.folders.filter((f) => f.type === 'Compendium').map(f => f.toObject()),
          }
        }
      ],
    );
    this.download(data, Core.getFilename('foundry-settings-export'));
  }

  static padNumber(number) {
    return (number < 10 ? '0' : '') + number;
  }

  static getFilename(filename) {
    const now = new Date();
    const yyyy = now.getFullYear();
    const MM = Core.padNumber(now.getMonth() + 1); // getMonth() is zero-based
    const dd  = Core.padNumber(now.getDate());
    const hh = Core.padNumber(now.getHours());
    const mm = Core.padNumber(now.getMinutes());
    const ss = Core.padNumber(now.getSeconds());
    return `${filename}-${yyyy}-${MM}-${dd}-${hh}-${mm}-${ss}-${game.world.id}.json`;
  }

  static importGameSettingsQuick() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.addEventListener('change', () => Core.importGameSettings(input.files[0]));
    input.click();
  }

  static async importGameSettings(file) {
    if (!file) {
      log(false, 'No file provided for game settings importer.');
      return;
    }

    try {
      const result = await foundry.utils.readTextFromFile(file);
      const settings = JSON.parse(result);
      const coreSettings = new Core(settings);
      coreSettings.render({ force: true });
    } catch (e) {
      console.error('Copy Environment | Could not parse import data.', e);
      console.error('Copy Environment | If you see an error for "maximum call stack size exceeded", try reducing the "Number of Characters" setting.');
    }
  }

  async processSettings(settings) {
    const updates = [];
    const creates = [];
    for (const data of settings) {
      const config = game.settings.settings.get(data.key);
      if (config?.scope === 'client') {
        const storage = game.settings.storage.get(config.scope);
        if (storage) {
          storage.setItem(data.key, data.value);
        }
      } else if (config?.scope === 'user' || game.user.isGM) {
        // User scoped settings are stored as Setting documents owned by the current user.
        const user = config?.scope === 'user' ? game.userId : null;
        const existing = game.settings.storage.get('world').getSetting(data.key, user);

        if (data.key === 'core.compendiumConfiguration') {
          // The Compendium Configuration setting maps compendiums to folders, and the FolderIDs
          // change in a new world, so migrating this value as is breaks the mapping.
          // Attempt to update the IDs to match the new world, but if that fails, just use the
          // existing value.
          try {
            const existingCompendiumMap = existing ? JSON.parse(existing._source.value) : {};
            const newCompendiumMap = JSON.parse(data.value);
            const missingEntries = new Map();

            // Replace IDs in the new map with the existing IDs if they exist.
            for (const [key, value] of Object.entries(newCompendiumMap)) {
              if (game.folders.get(existingCompendiumMap[key]?.folder)) {
                newCompendiumMap[key].folder = existingCompendiumMap[key].folder;
              } else {
                missingEntries.set(key, value);
              }
            }

            // Add any missing entries to the new map based on the supporting data.
            for (const [key, value] of missingEntries) {
              const folder = await this.createFolderRecursive(value?.folder);
              if (folder?.id) {
                newCompendiumMap[key].folder = folder.id;
              }
            }

            data.value = JSON.stringify(newCompendiumMap);
          } catch (e) {
            console.warn('Copy Environment | Could not process compendium configuration, overwriting value rather than merging.', e);
          }
        }

        if (existing?.id) {
          updates.push({
            _id: existing.id,
            key: data.key,
            value: data.value,
          });
        } else {
          creates.push({
            key: data.key,
            value: data.value,
            ...(user ? { user } : {}),
          });
        }
      }
    }
    // Settings are written directly through the socket so that onChange handlers of
    // the imported settings don't run before the world is reloaded.
    const SocketInterface = foundry.helpers.SocketInterface;
    try {
      if (updates.length) {
        log(true, `Updating ${updates.length} world settings.`, updates);
        await SocketInterface.dispatch('modifyDocument', {
          type: 'Setting',
          action: 'update',
          updates: updates,
          operation: {
            pack: null,
            parent: null,
            updates: updates,
          }
        });
      }
      if (creates.length) {
        log(true, `Creating ${creates.length} world settings.`, creates);
        await SocketInterface.dispatch('modifyDocument', {
          type: 'Setting',
          action: 'create',
          data: creates,
          operation: {
            pack: null,
            parent: null,
            data: creates,
          }
        });
      }
      return true;
    } catch (e) {
      log(true, `Settings update could not be dispatched to server.`);
      console.error(e);
      return false;
    }
  }

  // Recursively create folders for compendiums based on the supporting data.
  async createFolderRecursive(folderID) {
    if (game.folders.get(folderID)) {
      return game.folders.get(folderID);
    }

    const folderData = this.supportingData?.compendiumFolders?.find(f => f._id === folderID);
    if (!folderData) {
      return undefined;
    }

    // Create missing folder
    console.log(`Copy Environment | Creating missing folder "${folderData.name}" with ID ${folderID}`);
    // Check that the parent folder exists
    if (folderData.folder && !game.folders.get(folderData.folder)) {
      // Create missing parent folder
      const parentFolder = await this.createFolderRecursive(folderData.folder);
      if (parentFolder?.id) {
        folderData.folder = parentFolder.id;
      }
    }

    return CONFIG.Folder.documentClass.create(folderData, { keepId: true });
  }
}
