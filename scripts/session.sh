#!/usr/bin/env zsh

# Usage: session.sh <host> <session> <home_dir>

HOST=$1
SESSION=$2
HOME_DIR=$3

if [[ -z $HOST || -z $SESSION || -z $HOME_DIR ]]; then
  echo "Usage: ${0:t} <host> <session> <home_dir>"
  exit 1
fi

TMUX_CONF=$(base64 < ~/.tmux.conf)

TERM=xterm-256color ssh -t $HOST "
  echo '$TMUX_CONF' | base64 -D > ~/.tmux.conf && /opt/homebrew/bin/tmux source-file ~/.tmux.conf 2>/dev/null; true
  /opt/homebrew/bin/tmux has-session -t $SESSION 2>/dev/null \
    || /opt/homebrew/bin/tmux new-session -d -s $SESSION -c $HOME_DIR
  caffeinate -i -w \$\$ &
  /opt/homebrew/bin/tmux attach -t $SESSION
"
