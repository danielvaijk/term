# splash.zsh — Animated eye splash screen
[[ -o interactive && -t 0 ]] || return 0
python3 "${0:A:h}/splash.py" 2>/dev/null || true
