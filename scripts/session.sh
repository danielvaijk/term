#!/usr/bin/env zsh

# Usage: session.sh [-s session] [-l layout] [-c cwd] [user@host]
#
# Layouts (-l):
#   single  one pane (default)
#   split   left/right two panes
#   grid    2x2 four panes
#
# All panes start in -c. The layout flag only takes effect when the
# session is first created; reattaching ignores it.
#
# If user@host is given, the session runs on that remote host via SSH.

SESSION=main
LAYOUT=single
CWD="~"

while getopts "s:l:c:" opt; do
  case $opt in
    s) SESSION=$OPTARG ;;
    l) LAYOUT=$OPTARG ;;
    c) CWD=$OPTARG ;;
    *) echo "Usage: ${0:t} [-s session] [-l single|split|grid] [-c cwd] [user@host]"; exit 1 ;;
  esac
done
shift $((OPTIND - 1))

HOST=$1

case $LAYOUT in
  single|split|grid) ;;
  *) echo "Unknown layout: $LAYOUT (expected single|split|grid)"; exit 1 ;;
esac

if [[ -n $HOST ]]; then
  local ORIGIN=$(git -C "${0:A:h:h}" remote get-url origin 2>/dev/null)
  TERM=xterm-256color ssh -t $HOST "
  if [ -L ~/.config/zellij/config.kdl ] && [ -n \"$ORIGIN\" ]; then
    repo=\$(git -C \"\$(dirname \"\$(readlink ~/.config/zellij/config.kdl)\")\" rev-parse --show-toplevel 2>/dev/null)
    if [ -n \"\$repo\" ] && [ \"\$(git -C \"\$repo\" remote get-url origin 2>/dev/null)\" = \"$ORIGIN\" ]; then
      git -C \"\$repo\" pull --ff-only
    fi
  fi
  cd $CWD
  if zellij list-sessions --short 2>/dev/null | grep -qx $SESSION; then
    exec zellij attach $SESSION
  else
    exec zellij -n ~/.config/zellij/layouts/$LAYOUT.kdl -s $SESSION
  fi
"
else
  cd ${~CWD}
  if zellij list-sessions --short 2>/dev/null | grep -qx $SESSION; then
    exec zellij attach $SESSION
  else
    exec zellij -n ~/.config/zellij/layouts/$LAYOUT.kdl -s $SESSION
  fi
fi
