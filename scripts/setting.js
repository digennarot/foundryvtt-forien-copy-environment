import {name as moduleName, WORLD_SPECIFIC_FIELDS} from './config.js';

export default class Setting {
  /**
   * @param {Object} data - either World settings or Player settings
   */
  constructor(data) {
    this.type = Setting.UnknownType;
    this.data = data;
    this.value = undefined;

    if (!data || typeof data !== 'object') {
      console.error('Copy Environment | Unknown setting received:', data);
      return this;
    }

    if (data.key && data.value) {
      this.type = Setting.WorldType;
      this.value = new WorldSetting(this.data);
    } else if (data.name) {
      this.type = Setting.PlayerType;
      this.value = new PlayerSetting(this.data);
    } else if (data.type === Setting.SupportingDataType) {
      this.type = Setting.SupportingDataType;
      this.value = data.value;
    }
  }

  static UnknownType = '_unknownType';
  static PlayerType = '_playerType';
  static WorldType = '_worldType';
  static SupportingDataType = '_supportingDataType';

  isWorldSetting() {
    return this.type === Setting.WorldType;
  }

  isPlayerSetting() {
    return this.type === Setting.PlayerType;
  }

  isSupportingDataSetting() {
    return this.type === Setting.SupportingDataType;
  }

  hasChanges() {
    if (!this.value) {
      return false;
    }

    return this.value.hasChanges();
  }
}

/**
 * Returns the serialized (JSON) value of a setting as it is stored, rather than the initialized value
 * returned by game.settings.get, which can contain Color, Set or DataModel instances that don't survive
 * JSON serialization or comparison.
 * Falls back to the serialized initialized value (usually the default) when nothing is stored.
 * @param {string} namespace
 * @param {string} key
 * @returns {string|undefined}
 */
export function getSettingSource(namespace, key) {
  const id = `${namespace}.${key}`;
  const config = game.settings.settings.get(id);
  const scope = config?.scope ?? 'world';
  if (scope === 'client') {
    const stored = game.settings.storage.get('client')?.getItem(id);
    if (stored !== null && stored !== undefined) {
      return stored;
    }
  } else {
    const user = scope === 'user' ? game.userId : null;
    const stored = game.settings.storage.get('world')?.getSetting(id, user);
    if (stored) {
      return stored._source.value;
    }
  }
  if (!config) {
    return undefined;
  }
  return JSON.stringify(game.settings.get(namespace, key));
}

/**
 * WorldSetting represents a world level setting.
 */
export class WorldSetting {
  /**
   * Create a world setting from Foundry data.
   * @param {Object} setting
   */
  constructor(setting) {
    if (!setting) {
      throw 'Invalid data';
    }

    this.key = setting.key;
    this.value = WorldSetting.keepWorldSpecificFields(setting.key, setting.value);
    this.difference = this.calculateDifference();
    this.group = this.key.split('.').shift();
  }

  hasChanges() {
    return this.difference.hasChanges();
  }

  /**
   * Replace the fields of an imported object setting that are specific to each world
   * (see WORLD_SPECIFIC_FIELDS) with the values of the current world.
   * @param {string} key
   * @param {string} value Serialized imported value
   * @returns {string} Serialized value to import
   */
  static keepWorldSpecificFields(key, value) {
    const fields = WORLD_SPECIFIC_FIELDS[key];
    if (!fields || !value) {
      return value;
    }
    try {
      const imported = JSON.parse(value);
      const [namespace, ...rest] = key.split('.');
      const raw = getSettingSource(namespace, rest.join('.'));
      const current = raw === undefined ? undefined : JSON.parse(raw);
      if (foundry.utils.getType(imported) !== 'Object' || foundry.utils.getType(current) !== 'Object') {
        return value;
      }
      for (const field of fields) {
        imported[field] = current[field] ?? null;
      }
      return JSON.stringify(imported);
    } catch (e) {
      console.warn('Copy Environment | Could not keep world specific fields for', key, e);
      return value;
    }
  }

  /**
   * Compares the parsed JSON setting data if possible to handle object order differences.
   * @returns {Difference}
   */
  calculateDifference() {
    const keyParts = this.key.split('.');
    const namespace = keyParts.shift();
    const key = keyParts.join('.');
    let existingSetting;
    try {
      const raw = getSettingSource(namespace, key);
      if (raw !== undefined) {
        existingSetting = JSON.parse(raw);
      }
    } catch (e) {
      // do nothing, it just means the setting isn't registered, likely because the module isn't enabled.
    }
    try {
      let newValue = this.value;
      if (newValue) {
        newValue = JSON.parse(newValue);
      }
      if (typeof existingSetting === 'object' && typeof newValue === 'object') {
        let diff = foundry.utils.diffObject(existingSetting, newValue);
        if (foundry.utils.isEmpty(diff)) {
          // No difference in the underlying object.
          return new Difference(this.key, null, null);
        }
      }

      if (existingSetting === newValue) {
        return new Difference(this.key, null, null);
      }

      return new Difference(this.key, existingSetting, newValue);
    } catch (e) {
      console.error('Copy Environment | Could not parse world setting values:', this.key, e);
    }

    // Return the difference of the original values, not the parsed values.
    let existingSettings = game.settings.storage.get('world').getSetting(this.key);
    return new Difference(this.key, existingSettings?._source.value, this.value);
  }
}

/**
 * PlayerSetting represents a player level setting.
 */
export class PlayerSetting {
  /**
   * Create a player setting from Foundry data.
   * @param {Object} setting
   */
  constructor(setting) {
    if (!setting) {
      throw 'Invalid data';
    }

    this.name = setting.name;
    this.playerNotFound = false;
    this.playerDifferences = {};
    this.playerFlagDifferences = {};

    const existingUser = game.users.getName(this.name);
    if (!existingUser) {
      this.playerNotFound = true;
      return this;
    }

    const userData = existingUser._source;

    // Older exports serialized the Color object as a number, normalize to a CSS string.
    const color = setting.core.color == null ? null : foundry.utils.Color.from(setting.core.color);
    const importedColor = color?.valid ? color.css : null;
    if (setting.core.color != null && !importedColor) {
      console.warn('Copy Environment | Skipping invalid color for user', this.name, setting.core.color);
    }
    if (importedColor && importedColor !== userData.color) {
      this.playerDifferences.color = new Difference(
        'color',
        userData.color,
        importedColor
      );
    }

    if (setting.core.role !== userData.role) {
      this.playerDifferences.role = new Difference(
        'role',
        userData.role,
        setting.core.role
      );
    }

    if (JSON.stringify(setting.core.permissions) !== JSON.stringify(userData.permissions)) {
      this.playerDifferences.permissions = new Difference(
        'permissions',
        userData.permissions,
        setting.core.permissions
      );
    }

    let flagDiff = foundry.utils.diffObject(userData.flags, setting.flags);
    for (const prop in flagDiff) {
      if (!flagDiff.hasOwnProperty(prop)) {
        continue;
      }
      this.playerFlagDifferences[prop] = new Difference(
        prop,
        userData.flags[prop],
        flagDiff[prop]
      );
    }

    this.name = setting.name;
    this.value = setting.value;
  }

  /**
   * Returns whether this player setting is identical to a player of the same name in the current world.
   * @returns boolean
   */
  hasChanges() {
    return this.playerNotFound || this.hasDataChanges();
  }

  /**
   * Returns whether this player setting has the same data values as a player of the same name in the current world.
   * Note that if there is not a matching player, there are no data changes.
   * @see hasChanges
   * @returns boolean
   */
  hasDataChanges() {
    return !foundry.utils.isEmpty(this.playerDifferences) || !foundry.utils.isEmpty(this.playerFlagDifferences);
  }
}

/**
 * Difference represents the difference between the existing setting and the proposed setting.
 */
export class Difference {
  /**
   * Create a setting difference.
   * @param {string} name
   * @param {*} oldValue
   * @param {*} newValue
   */
  constructor(name, oldValue, newValue) {
    this.name = name;
    if (oldValue !== newValue) {
      let diffSize = game.settings.get(moduleName, "diff-length");
      if (diffSize < 0) {
        diffSize = 0;
      }

      this.oldVal = oldValue;
      this.oldString = JSON.stringify(oldValue);
      if (diffSize && this.oldString?.length > diffSize) {
        this.oldString = this.oldString.substring(0, diffSize) + '...';
      }
      this.newVal = newValue;
      this.newString = JSON.stringify(newValue);
      if (diffSize && this.newString?.length > diffSize) {
        this.newString = this.newString.substring(0, diffSize) + '...';
      }
    }
  }

  hasChanges() {
    return this.oldVal !== this.newVal;
  }
}
