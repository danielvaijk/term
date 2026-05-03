# splash.zsh — Animated eye splash screen
[[ -o interactive && -t 0 ]] || return 0
# Inside a zellij pane each shell would re-trigger the splash; the splash is
# played by session.sh before zellij starts instead.
[[ -z $ZELLIJ ]] || return 0
python3 "${0:A:h}/splash.py" 2>/dev/null || true
