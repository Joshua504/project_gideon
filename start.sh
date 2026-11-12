#!/bin/bash
# Suppress harmless Linux warnings for Electron
export GDK_BACKEND=x11
export GLIB_LOG_FLAGS=0
export G_MESSAGES_DEBUG=false
export NO_AT_BRIDGE=1

cd "$(dirname "$0")"
npx electron . --no-sandbox "$@" 2>&1 | grep -v -E '(dconf-WARNING.*greeter-dconf-defaults|GetVSyncParametersIfAvailable\(\) failed)'
