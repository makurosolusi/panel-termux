# Android settings that keep the server alive

Android likes to stop apps in the background. The settings below keep Termux, the panel and
your sites running while the screen is off and after the phone restarts.

## 1. Install Termux from the right source

Install Termux (`com.termux`) from F-Droid or GitHub (github.com/termux/termux-app/releases).
The Play Store version is different and does not work. Termux:Boot and Termux:API must come from
the same source as Termux, because their signatures must match. Do not mix F-Droid and GitHub.

## 2. Termux:Boot (starts the services when the phone turns on)

1. Install the Termux:Boot app (`com.termux.boot`).
2. Open Termux:Boot once from the app drawer. Unless it was opened once, Android does not
   run it when the phone starts.
3. `panel init` writes the script `~/.termux/boot/panel-termux`, which runs every time the
   phone starts: it calls `termux-wake-lock` and starts the runit services (`termux-services`).

## 3. Termux:API (battery, wake-lock, opening links)

1. Install the Termux:API app (`com.termux.api`).
2. `panel init` installs the `termux-api` package (by hand: `pkg install termux-api`).
3. Try it: `termux-battery-status`. If it prints JSON, it is connected.

## 4. Unrestricted battery

Settings → Apps → Termux → Battery → choose Unrestricted (the menu name differs per brand:
"Unrestricted", "Not optimized", "No restrictions"). Repeat for Termux:Boot and Termux:API.
On Xiaomi/POCO phones, also turn on Autostart for all three.

## 5. Wake-lock

`termux-wake-lock` keeps the CPU running while the screen is off. The first time, the phone asks
about battery permission: choose Allow. The Termux notification then shows "wake lock held".
To release it: `termux-wake-unlock`.

## 6. Child process limit (Android 12 and later)

Android 12+ stops child processes when there are too many, and pm2 with several sites easily
goes past that limit.

- Android 14 and later: Developer options → turn on "Disable child process restrictions".
- Android 12 and 13: from a computer with adb, run:

```
adb shell "/system/bin/device_config set_sync_disabled_for_tests persistent"
adb shell "/system/bin/device_config put activity_manager max_phantom_processes 2147483647"
```

Check everything at once: `panel doctor`.
