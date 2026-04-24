#!/usr/bin/env zsh

# Usage: session.sh [-l layout] [-s session] [-c cwd] [user@host]
#
# Layout: 1 = single pane (default)
#         2 = 1x1 (left/right split)
#         3 = 2x1 (left pane, right top/bottom)
#         4 = 2x2 (four panes)
#
# If user@host is given, the session runs on that remote host via SSH.

LAYOUT=1
SESSION=main
CWD="~"

while getopts "l:s:c:" opt; do
  case $opt in
    l) LAYOUT=$OPTARG ;;
    s) SESSION=$OPTARG ;;
    c) CWD=$OPTARG ;;
    *) echo "Usage: ${0:t} [-l layout] [-s session] [-c cwd] [user@host]"; exit 1 ;;
  esac
done
shift $((OPTIND - 1))
HOST=$1

if [[ $LAYOUT != [1-4] ]]; then
  echo "Invalid layout: $LAYOUT (must be 1-4)"
  exit 1
fi

build_layout() {
  local tmux=$1 cwd=$2
  case $LAYOUT in
    2)
      $tmux split-window -h -c $cwd
      $tmux select-pane -t 1
      ;;
    3)
      $tmux split-window -h -c $cwd
      $tmux split-window -v -c $cwd
      $tmux select-pane -t 1
      ;;
    4)
      $tmux split-window -h -c $cwd
      $tmux select-pane -t 1
      $tmux split-window -v -c $cwd
      $tmux select-pane -t 3
      $tmux split-window -v -c $cwd
      $tmux select-pane -t 1
      ;;
  esac
}

if [[ -n $HOST ]]; then
  TMUX_CONF=$(base64 < ~/.tmux.conf)
  LAYOUT_CMDS=""
  if [[ $LAYOUT != 1 ]]; then
    case $LAYOUT in
      2)
        LAYOUT_CMDS="
    /opt/homebrew/bin/tmux split-window -h -c $CWD
    /opt/homebrew/bin/tmux select-pane -t 1"
        ;;
      3)
        LAYOUT_CMDS="
    /opt/homebrew/bin/tmux split-window -h -c $CWD
    /opt/homebrew/bin/tmux split-window -v -c $CWD
    /opt/homebrew/bin/tmux select-pane -t 1"
        ;;
      4)
        LAYOUT_CMDS="
    /opt/homebrew/bin/tmux split-window -h -c $CWD
    /opt/homebrew/bin/tmux select-pane -t 1
    /opt/homebrew/bin/tmux split-window -v -c $CWD
    /opt/homebrew/bin/tmux select-pane -t 3
    /opt/homebrew/bin/tmux split-window -v -c $CWD
    /opt/homebrew/bin/tmux select-pane -t 1"
        ;;
    esac
  fi

  TERM=xterm-256color ssh -t $HOST "
  echo '$TMUX_CONF' | base64 -D > ~/.tmux.conf && /opt/homebrew/bin/tmux source-file ~/.tmux.conf 2>/dev/null; true
  /opt/homebrew/bin/tmux has-session -t $SESSION 2>/dev/null || {
    /opt/homebrew/bin/tmux new-session -d -s $SESSION -c $CWD$LAYOUT_CMDS
  }
  caffeinate -i -w \$\$ &
  /opt/homebrew/bin/tmux attach -t $SESSION
"
else
  TMUX=tmux
  $TMUX has-session -t $SESSION 2>/dev/null || {
    $TMUX new-session -d -s $SESSION -c $CWD
    build_layout $TMUX $CWD
  }
  $TMUX attach -t $SESSION
fi
