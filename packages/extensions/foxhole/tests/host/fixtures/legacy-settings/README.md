# Legacy settings fixtures

These are synthesized examples of the persisted/exported formats in the
`C:\Code\game-kitchen` checkout, not exports from a user's browser profile.

- `Game.downloadSettings()` in `app/plugins/libs/game.js` exports `{ settings: this.settings }`.
- `Game.storeSettings()` stores the raw settings JSON string as `foxhole_settings`
  in the origin-local `game-kitchen` localForage instance. Earlier Foxhole
  versions used the localStorage key `settings`.
- `Game.SETTINGS_VERSION` is 2. `Game.loadSettings()` also recognizes the earlier
  array of toolbelts, illustrated in `raw-v1.json`.
- `app/components/menu/construction/Toolbelt.vue` writes `building`, `icon`,
  `blueprint`, `clipboard`, and `mode` slots with `subtype`, `eData`, and/or `icon`.
- The live browser uses `projectBrowserView` and `projectBrowserIconScale`.
  `assetsBrowserIconScale` remains in defaults but is not its active icon-size preference.
- `snapRotationDegrees` and `keySnapRotationDegrees` are independent numeric degree
  values (15 and 45 by default), bounded to 1-360 by legacy Settings.vue. Nixie maps
  these to mouse snapping and relative keyboard steps. Keyboard steps retain
  Nixie's behavior independently of the mouse snap toggle, with Shift doubling them.

Identifiers `fortt1`, `crane`, `metal`, and `worldroad` exist in the legacy authored
asset data. Tests resolve them through the checked-in Nixie manifest and catalogs,
including the explicit `worldroad` to `greatmarchroad` remap. `removed-building`
is deliberately unknown. Blueprints, clipboard selections, styled tools, and
structure-as-icon bindings deliberately exercise skipped-item reporting.
