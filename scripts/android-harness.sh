#!/usr/bin/env bash
# Drive the Android emulator as a correctness harness for the mobile join path.
#
# Why this exists: the join flow's last mile is a `buzz://` deep link handed to
# a phone. Playwright cannot see that hop, and rendering bugs on our own consent
# page went unnoticed because the page was "verified" by grepping its HTML
# instead of looking at it. This boots a real Android device and screenshots
# what a user actually sees.
#
# Usage:
#   scripts/android-harness.sh boot [avd]        # boot headless, wait for ready
#   scripts/android-harness.sh open <url>        # open a URL in Chrome
#   scripts/android-harness.sh shot <out.png>    # screenshot the device
#   scripts/android-harness.sh handlers <scheme> # who handles e.g. buzz://
#   scripts/android-harness.sh stop
#
# Known limits (2026-08-01): Buzz publishes NO Android artifact on GitHub
# Releases (checked 30 releases, 0 .apk/.aab) and there is no Flutter toolchain
# here, so the real Buzz app cannot be installed or built without either a Play
# Store sign-in or installing Flutter and building /tmp/block-buzz/mobile.
# Until then this harness verifies OUR side (the consent page and the deep link
# we emit), not Buzz's handling of it.
set -euo pipefail

export ANDROID_HOME="${ANDROID_HOME:-$HOME/android-sdk}"
PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"
CHROME=com.android.chrome/com.google.android.apps.chrome.Main

cmd="${1:-}"; shift || true

case "$cmd" in
  boot)
    avd="${1:-se_test33}"
    if adb shell getprop sys.boot_completed 2>/dev/null | grep -q 1; then
      echo "already booted"; exit 0
    fi
    nohup emulator -avd "$avd" -no-window -no-audio -no-boot-anim \
      -gpu swiftshader_indirect >/tmp/android-harness-emu.log 2>&1 &
    for _ in $(seq 1 40); do
      [ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ] \
        && { echo "booted"; exit 0; }
      sleep 5
    done
    echo "emulator did not boot; see /tmp/android-harness-emu.log" >&2; exit 1
    ;;
  open)
    # Target Chrome explicitly: a bare VIEW intent lands nowhere on this image.
    adb shell am start -n "$CHROME" -a android.intent.action.VIEW -d "$1" >/dev/null
    sleep "${2:-12}"
    ;;
  shot)
    adb exec-out screencap -p > "$1"
    echo "wrote $1 ($(stat -c %s "$1") bytes)"
    ;;
  handlers)
    # 0 means nothing on the device will answer that scheme.
    n=$(adb shell "cmd package query-activities -a android.intent.action.VIEW -d '$1' 2>/dev/null" \
        | grep -c packageName || true)
    echo "handlers for $1: $n"
    ;;
  stop)
    adb emu kill 2>/dev/null || true; echo "stopped"
    ;;
  *)
    sed -n '2,25p' "$0"; exit 1
    ;;
esac
