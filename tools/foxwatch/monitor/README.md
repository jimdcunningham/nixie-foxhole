# FoxWatch Monitor (Deprecated)

The WinForms tray host is deprecated. Use [FoxWatch Desktop](../../foxwatch-desktop/README.md),
the Electron/Vue app, for build polling, generation progress, asset inspection,
comparisons, settings, credentials, and explicit publishing. Desktop supports
Windows startup, hide-to-tray, and polling that waits for each run to finish.

This directory and its installer/open/uninstall commands remain for rollback;
new feature work belongs in Desktop. The shared CLI pipeline in `../scripts/`
and `../run-foxwatch.mjs` remains supported and powers the replacement app.

Migration is explicit: close the old host after active work finishes, enable
Windows startup/minimized startup in Desktop Settings, save, then start polling
on the Dashboard when ready. Saving Settings reapplies Desktop's startup entry
even if its checkbox was already enabled. Configuration, credentials, Steam
installations, generated assets, logs, and successful-build state are reused.

Deprecation does not stop running applications, remove installed binaries,
change startup entries, enable polling, upload assets, or send notifications.
