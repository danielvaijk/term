#!/usr/bin/env zsh

# Usage: session.sh [-s session] [-c cwd] [-p dir ...] [user@host]
#
# Panes (-p): each argument adds a pane, its value is the directory
#             relative to cwd. Count determines layout:
#             1 pane  = single (default if -p omitted)
#             2 panes = left/right split
#             3 panes = top-left, top-right, bottom full-width
#             4 panes = 2x2 grid
#
# If user@host is given, the session runs on that remote host via SSH.

SESSION=main
CWD="~"
PANES=()

while getopts "s:c:p:" opt; do
  case $opt in
    s) SESSION=$OPTARG ;;
    c) CWD=$OPTARG ;;
    p) PANES+=("$OPTARG") ;;
    *) echo "Usage: ${0:t} [-s session] [-c cwd] [-p dir ...] [user@host]"; exit 1 ;;
  esac
done
shift $((OPTIND - 1))

HOST=$1

if (( ${#PANES} == 0 )); then
  PANES=(".")
fi

if (( ${#PANES} > 4 )); then
  echo "Too many panes: ${#PANES} (max 4)"
  exit 1
fi

resolve() {
  local base=$1 rel=$2
  if [[ $rel == /* ]]; then
    echo $rel
  else
    echo "${base%/}/${rel}"
  fi
}

if [[ -n $HOST ]]; then
  TMUX_CONF=$(base64 < ~/.tmux.conf)
  LAYOUT_CMDS=""

  local T=/opt/homebrew/bin/tmux
  case ${#PANES} in
    2)
      LAYOUT_CMDS="
    $T split-window -h -c $(resolve $CWD $PANES[2])
    $T select-pane -t 1"
      ;;
    3)
      LAYOUT_CMDS="
    $T split-window -v -c $(resolve $CWD $PANES[3])
    $T select-pane -t 1
    $T split-window -h -c $(resolve $CWD $PANES[2])
    $T select-pane -t 1"
      ;;
    4)
      LAYOUT_CMDS="
    $T split-window -h -c $(resolve $CWD $PANES[2])
    $T select-pane -t 1
    $T split-window -v -c $(resolve $CWD $PANES[3])
    $T select-pane -t 3
    $T split-window -v -c $(resolve $CWD $PANES[4])
    $T select-pane -t 1"
      ;;
  esac

  local p1=$(resolve $CWD $PANES[1])
  TERM=xterm-256color ssh -t $HOST "
  echo '$TMUX_CONF' | base64 -D > ~/.tmux.conf && /opt/homebrew/bin/tmux source-file ~/.tmux.conf 2>/dev/null; true
  /opt/homebrew/bin/tmux has-session -t $SESSION 2>/dev/null || {
    /opt/homebrew/bin/tmux new-session -d -s $SESSION -c $p1$LAYOUT_CMDS
  }
  caffeinate -i -w \$\$ &
  /opt/homebrew/bin/tmux attach -t $SESSION
"
else
  TMUX=tmux
  local p1=$(resolve $CWD $PANES[1])
  $TMUX has-session -t $SESSION 2>/dev/null || {
    $TMUX new-session -d -s $SESSION -c $p1
    case ${#PANES} in
      2)
        $TMUX split-window -h -c $(resolve $CWD $PANES[2])
        $TMUX select-pane -t 1
        ;;
      3)
        $TMUX split-window -v -c $(resolve $CWD $PANES[3])
        $TMUX select-pane -t 1
        $TMUX split-window -h -c $(resolve $CWD $PANES[2])
        $TMUX select-pane -t 1
        ;;
      4)
        $TMUX split-window -h -c $(resolve $CWD $PANES[2])
        $TMUX select-pane -t 1
        $TMUX split-window -v -c $(resolve $CWD $PANES[3])
        $TMUX select-pane -t 3
        $TMUX split-window -v -c $(resolve $CWD $PANES[4])
        $TMUX select-pane -t 1
        ;;
    esac
  }
  $TMUX attach -t $SESSION
fi
