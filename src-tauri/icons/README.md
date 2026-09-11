# Desktop app icons

These PNGs / `.icns` / `.ico` **are** the artwork — there is no vector source
checked in. Edit them as images, or regenerate the whole set from a single
1024×1024 master with `npx tauri icon <master.png>` (then delete the `android/`
and `ios/` directories it also emits; this app is Mac + Windows only).

Two properties any replacement master must have, both of which are easy to lose:

- **Transparent corners.** The artwork is a rounded blue tile inset in a larger
  transparent canvas (at 512: a 412×412 tile with ~83px corner radius, inset
  50px). macOS renders the PNG as-is and does not mask it. Beware of any tool
  that flattens alpha — `qlmanage -t`, for instance, composites SVGs onto solid
  white, which produces an icon that looks subtly wrong (square white corners)
  rather than obviously broken.
- **Not the mobile icon.** `mobile/assets/icon.png` is the same robot mark but
  drawn full-bleed with no inset and no rounded corners, because iOS applies
  its own mask. Reusing it on desktop yields a flat square tile.

The tray icons (`tray-icon.png`, `tray-icon@2x.png`) are separate hand-made
monochrome templates — `iconAsTemplate: true` in `tauri.conf.json` means macOS
recolors them for light/dark menu bars. `tauri icon` does not touch them; keep
it that way.

The same brand mark also appears as `web/public/favicon.svg`. If the mark
changes, desktop, web and mobile move together.
