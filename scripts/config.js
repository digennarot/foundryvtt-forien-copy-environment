export const name = 'forien-copy-environment';

export const templates = {
  settings: `modules/${name}/templates/settings.html`,
};

/**
 * Settings that should never be selected for import by default.
 * - core.time: the world time is specific to each world.
 * - pf2e.worldClock.worldCreatedOn: legacy PF2e key (pre 0.936 migration), now part of pf2e.worldClock.
 */
export const DEFAULT_UNSELECTED = {
  'core.time': false,
  'pf2e.worldClock.worldCreatedOn': false,
};

/**
 * Core settings deprecated in v14 without replacement, reading them only logs a warning.
 */
export const DEPRECATED_SETTINGS = ['core.gridTemplates', 'core.coneTemplateType'];

/**
 * Fields of object settings that are specific to each world, and are kept from the current world on import.
 */
export const WORLD_SPECIFIC_FIELDS = {
  'pf2e.worldClock': ['worldCreatedOn'],
};

export function log(force, ...args) {
  try {
    if (typeof force !== "boolean") {
      console.warn(
        'Copy Environment | Invalid log usage. Expected "log(force, ...args)" as boolean but got',
        force
      );
    }

    const isDebugging = window.DEV?.getPackageDebugValue(name);

    if (force || isDebugging) {
      console.log("Copy Environment |", ...args);
    }
  } catch (e) {
  }
}
