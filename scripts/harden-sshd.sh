#!/usr/bin/env zsh

# Install or inspect the SSH daemon policy expected by scripts/session.sh on a
# managed remote host.

set -euo pipefail

CONFIG_DIR=/etc/ssh/sshd_config.d
CONFIG_FILE=$CONFIG_DIR/term-device-auth.conf
MAIN_CONFIG=/etc/ssh/sshd_config
INCLUDE_LINE="Include $CONFIG_DIR/*"

usage() {
  cat <<'EOF'
Usage: harden-sshd.sh [--install|--check|--print]

  --install  install the managed remote SSH authentication policy
  --check    print the effective authentication settings
  --print    print the managed config snippet

Run this on a remote host that should only accept approved SSH public keys.
EOF
}

sshd_bin() {
  if command -v sshd >/dev/null 2>&1; then
    command -v sshd
  elif [[ -x /usr/sbin/sshd ]]; then
    print -r -- /usr/sbin/sshd
  else
    print -u2 "error: sshd not found"
    exit 1
  fi
}

print_snippet() {
  cat <<'EOF'
# Managed by term/scripts/harden-sshd.sh.
# Device authorization lives in the user's authorized_keys file or in a
# separately configured trusted user CA.
PubkeyAuthentication yes
PasswordAuthentication no
KbdInteractiveAuthentication no
ChallengeResponseAuthentication no
PermitRootLogin no
AuthenticationMethods publickey
EOF
}

install_policy() {
  local sshd
  sshd=$(sshd_bin)

  sudo mkdir -p "$CONFIG_DIR"

  if [[ -f $MAIN_CONFIG ]] && ! sudo grep -Eq "^[[:space:]]*Include[[:space:]]+$CONFIG_DIR/\\*" "$MAIN_CONFIG"; then
    local backup="$MAIN_CONFIG.term-backup.$(date +%Y%m%d%H%M%S)"
    sudo cp "$MAIN_CONFIG" "$backup"
    local tmp
    tmp=$(mktemp -t term-sshd-config.XXXXXX)
    {
      print -r -- "$INCLUDE_LINE"
      sudo cat "$MAIN_CONFIG"
    } > "$tmp"
    sudo install -m 0644 "$tmp" "$MAIN_CONFIG"
    rm -f "$tmp"
    print "updated $MAIN_CONFIG; backup saved at $backup"
  fi

  local snippet
  snippet=$(mktemp -t term-sshd-snippet.XXXXXX)
  print_snippet > "$snippet"
  sudo install -m 0644 "$snippet" "$CONFIG_FILE"
  rm -f "$snippet"

  sudo "$sshd" -t
  reload_sshd
  print "installed $CONFIG_FILE"
}

reload_sshd() {
  if command -v launchctl >/dev/null 2>&1 && launchctl print system/com.openssh.sshd >/dev/null 2>&1; then
    sudo launchctl kickstart -k system/com.openssh.sshd
  elif command -v systemctl >/dev/null 2>&1; then
    sudo systemctl reload sshd 2>/dev/null || sudo systemctl reload ssh 2>/dev/null || true
  else
    print "sshd config validated; reload sshd manually if needed"
  fi
}

check_policy() {
  local sshd
  sshd=$(sshd_bin)

  "$sshd" -T 2>/dev/null | awk '
    $1 == "pubkeyauthentication" ||
    $1 == "passwordauthentication" ||
    $1 == "kbdinteractiveauthentication" ||
    $1 == "challengeresponseauthentication" ||
    $1 == "permitrootlogin" ||
    $1 == "authenticationmethods" {
      print
    }
  '
}

case "${1:---check}" in
  --install)
    install_policy
    ;;
  --check)
    check_policy
    ;;
  --print)
    print_snippet
    ;;
  -h|--help)
    usage
    ;;
  *)
    usage
    exit 1
    ;;
esac
