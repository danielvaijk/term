# splash.zsh — Animated eye splash screen
# Reveals braille eye art from center outward, then idles with
# a scan-line sweep and periodic blink. Any key dismisses.

[[ -o interactive && -t 0 ]] || return 0

() {
  local -a art=(
    '⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⡯⣍⡻⠟⠯⠁⠊⠛⠛⠽⠛⠿⣻⢧⠀⠀⠀⠀⠀⠀⠀'
    '⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣟⡻⢿⣿⡿⣿⡿⠧⠒⠒⠒⠄⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠁⠣⠀⠀⠀⠀⠀⠀'
    '⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⡿⠿⣉⣙⡛⠲⠍⠊⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀'
    '⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⡿⢿⣿⡿⣿⡯⠛⠒⠈⠈⠁⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀'
    '⣿⣿⣿⣿⡟⢿⢟⡫⠂⠟⠩⠾⠟⠋⠉⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢀⣀⣠⣤⣀⣀⣀⣀⣀⣀⢀⠀⠀⠀⠀⠀⠀⠀⠀'
    '⣿⣿⢋⠅⡈⡠⠍⠀⡀⠀⠁⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣀⣤⣴⣾⣿⣶⣟⣻⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣶⡀⠀⠀⠀⠀⠀'
    '⣿⢣⣦⠊⠀⠀⢀⠀⢀⠄⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣀⣠⣶⣶⡿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣧⠀⠀⠀⠀⠀⠀'
    '⣭⡿⠡⢀⠆⠀⠀⠠⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢀⣄⣦⣿⣿⣿⡟⠟⢈⣿⣿⡟⠝⠝⢉⣽⡿⢿⣿⣿⣿⣿⣿⣿⣿⣿⣗⡙⡈⡀⠀⠀⠀⠀'
    '⣽⡾⠁⠎⠀⢀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣀⡤⢴⡐⢿⣾⣿⣿⣿⣿⣿⠏⠀⣐⢾⠍⠈⠀⠀⣺⠗⠀⠉⠈⠙⢹⣿⣿⣿⣿⣿⣿⣷⣭⡵⠀⠀⠀⠀'
    '⣿⣗⡀⠠⠀⠀⠠⠀⢀⠀⣄⣤⣶⣢⢴⣗⣾⣿⣷⡍⠌⠸⠿⡿⢛⡻⠃⠀⠀⠀⠁⠀⠀⠀⠀⠀⠀⠀⠀⠀⠈⠀⠈⠙⠏⠵⢻⢿⣿⣗⣢⠀⠀⠀⠀'
    '⣿⣿⣦⣥⣶⣀⣀⣴⣧⣾⣻⣿⣿⠿⢿⣟⣿⠿⠻⠹⠈⠀⠈⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠰⠇⠀⠀⠀⡈⠿⢿⡅⠀⠀⠀⠀'
    '⣿⣿⢟⣿⣷⣿⣿⣾⣿⣿⣿⣿⣿⠳⠉⠂⠁⡀⠀⠀⠀⠀⠀⠀⠀⡀⢀⡤⣠⡀⠀⢀⣀⣀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠠⠉⠁⠀⠀⠀⠀'
    '⣿⣿⣾⣿⣿⣿⣿⣿⣿⣿⡿⠟⠁⠀⠀⡀⠁⠀⠀⣀⠀⠀⠰⠆⠀⠁⠈⠛⠋⠀⣠⣾⣿⡻⣿⣷⣦⣀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀'
    '⣿⣿⣟⣿⣿⣿⣿⣿⡛⠁⠈⠀⠀⠼⠃⠀⠀⣀⣾⣿⣿⣦⣤⣤⣤⣤⣤⣤⣶⣿⣿⣿⣿⣿⣿⣿⣿⣿⣷⣦⢀⡀⠀⠀⠀⠀⠀⡀⢲⡖⣼⣊⡬⡀⡄'
    '⣿⣿⠘⠻⣿⣿⣻⠋⠀⠀⣀⠠⡈⠀⠀⢠⣶⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⢟⠃⠎⠀⠀⠀⠀⠠⠠⠄⢾⠾⣿⣿⣮⣧⣿'
    '⣿⣿⣯⢒⡟⢟⠁⠀⠀⡠⢦⡤⠀⣀⡠⡨⢿⠿⠿⠿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⡿⡿⣟⡽⠟⠗⠈⠀⠀⠀⠀⠀⠀⠄⢀⢈⡙⢻⠻⣿⣿⣿⡿'
    '⣿⣿⣿⣿⣿⡎⠀⢀⡤⢦⡮⠀⠀⠀⠀⣀⣀⠄⣀⣀⠀⠀⠀⠉⠉⠉⠉⠉⠉⠉⠐⠀⠈⠉⠁⠀⠀⠀⠀⠀⠀⠀⢀⣠⡐⣤⣝⣧⣹⣾⣿⣿⣿⣿⣿'
    '⣿⣿⠻⣮⡏⠵⣦⣴⣷⡷⠁⣀⣶⣾⣿⣿⣟⣺⠟⣁⠀⠍⢐⣈⠀⡈⠃⠀⠀⢫⣔⡠⣄⠀⠈⠀⠀⠀⠀⠀⠀⠀⡊⣿⣿⣾⣿⣿⣿⣿⣿⣿⣿⣿⣿'
    '⣿⣿⢀⣦⣿⠟⢛⢗⡅⡻⡇⡜⣿⣿⣿⣿⣿⣿⣿⣿⣷⣶⣿⣿⣷⣶⣿⣬⣿⣿⣿⣿⣶⣦⣷⠺⣷⣠⣤⣤⣴⣴⣶⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿'
    '⣽⣿⣿⡻⣿⢾⡿⢂⢅⢮⣼⢵⣼⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣽⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿'
    '⣿⣿⣻⣷⣶⣼⣅⣬⣾⣷⣿⣷⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣷⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣽⣇⣿⣿⣿⣿⣿⣿⣟'
  )

  local art_h=${#art}
  local art_w=55
  local mid=$(( (art_h + 1) / 2 ))  # line 11 (1-indexed)

  # Skip if terminal is too small
  (( COLUMNS < art_w + 4 || LINES < art_h + 4 )) && return

  # Enter alternate screen, hide cursor
  tput smcup
  tput civis
  printf '\e[2J'

  # Clean up on Ctrl-C
  trap 'tput cnorm; tput rmcup; return' INT

  # --- Render one frame ---
  # Args: $1=reveal_radius  $2=scan_pos  $3=blink_state
  _sf() {
    local reveal=$1 scan=$2 blink=$3
    local y=$(( (LINES - art_h) / 2 ))
    local x=$(( (COLUMNS - art_w) / 2 ))
    (( y < 1 )) && y=1
    (( x < 1 )) && x=1

    local pad
    printf -v pad '%*s' "$x" ''
    local out='\e[H'

    local i dist sgr
    for (( i = 1; i <= art_h; i++ )); do
      local line_y=$(( y + i - 1 ))
      dist=$(( i - mid ))
      (( dist < 0 )) && dist=$(( -dist ))

      out+="\e[${line_y};1H\e[2K"

      # Only show lines within reveal radius
      (( dist >= reveal )) && continue

      sgr='\e[38;5;248m'

      # Blink: dim middle rows progressively
      if (( blink >= 1 && blink <= 5 )); then
        if (( blink == 1 || blink == 5 )); then
          (( dist < 3 )) && sgr='\e[38;5;243m'
        elif (( blink == 2 || blink == 4 )); then
          (( dist < 5 )) && sgr='\e[38;5;239m'
        elif (( blink == 3 )); then
          (( dist < 7 )) && sgr='\e[38;5;236m'
        fi
      fi

      # Scan line: bright band
      if (( i == scan )); then
        sgr='\e[1;97m'
      elif (( i == scan - 1 || i == scan + 1 )); then
        sgr='\e[38;5;253m'
      elif (( i == scan - 2 || i == scan + 2 )); then
        sgr='\e[38;5;250m'
      fi

      out+="${pad}${sgr}${art[$i]}\e[0m"
    done

    # "press any key" hint
    local msg='press any key'
    local msg_x=$(( (COLUMNS - ${#msg}) / 2 ))
    local msg_y=$(( y + art_h + 2 ))
    if (( msg_y <= LINES )); then
      out+="\e[${msg_y};${msg_x}H\e[38;5;240m${msg}\e[0m"
    fi

    printf '%b' "$out"
  }

  # --- Phase 1: reveal from center (eye opening) ---
  local reveal
  for (( reveal = 1; reveal <= mid + 1; reveal++ )); do
    _sf "$reveal" 0 0
    if read -sk1 -t 0.08 2>/dev/null; then
      tput cnorm; tput rmcup; return
    fi
  done

  # --- Phase 2: idle — scan line + periodic blink ---
  local scan=1 scan_dir=1 tick=0 blink=0

  while true; do
    _sf "$(( mid + 1 ))" "$scan" "$blink"

    if read -sk1 -t 0.06 2>/dev/null; then
      break
    fi

    # Advance scan line
    (( scan += scan_dir ))
    (( scan > art_h )) && scan_dir=-1
    (( scan < 1 ))     && scan_dir=1

    # Blink timer
    (( tick++ ))
    if (( blink > 0 && blink < 6 )); then
      (( blink++ ))
    elif (( blink >= 6 )); then
      blink=0
    elif (( tick % 50 == 0 )); then
      blink=1
    fi
  done

  unfunction _sf 2>/dev/null
  tput cnorm
  tput rmcup
}
