#!/usr/bin/env zsh

# Enable Touch ID authentication for sudo on macOS.

set -euo pipefail

SUDO_LOCAL=/etc/pam.d/sudo_local
SUDO_LOCAL_TEMPLATE=/etc/pam.d/sudo_local.template
PAM_TID_LINE="auth       sufficient     pam_tid.so"

if [[ "$(uname -s)" != Darwin ]]; then
  print "skipping sudo Touch ID setup; pam_tid.so is macOS-only"
  exit 0
fi

tmp=$(mktemp -t sudo-local.XXXXXX)
trap 'rm -f "$tmp"' EXIT INT TERM

if [[ -f $SUDO_LOCAL ]]; then
  cp "$SUDO_LOCAL" "$tmp"
elif [[ -f $SUDO_LOCAL_TEMPLATE ]]; then
  cp "$SUDO_LOCAL_TEMPLATE" "$tmp"
else
  cat > "$tmp" <<'EOF'
# sudo_local: local config file which survives system update and is included for sudo
EOF
fi

if grep -Eq '^[[:space:]]*auth[[:space:]]+sufficient[[:space:]]+pam_tid\.so([[:space:]]|$)' "$tmp"; then
  print "sudo Touch ID is already enabled"
  exit 0
fi

if grep -Eq '^[[:space:]]*#auth[[:space:]]+sufficient[[:space:]]+pam_tid\.so([[:space:]]|$)' "$tmp"; then
  sed -i '' -E 's/^[[:space:]]*#auth[[:space:]]+sufficient[[:space:]]+pam_tid\.so/auth       sufficient     pam_tid.so/' "$tmp"
else
  print -r -- "$PAM_TID_LINE" >> "$tmp"
fi

sudo install -m 0444 "$tmp" "$SUDO_LOCAL"
print "enabled Touch ID for sudo in $SUDO_LOCAL"
