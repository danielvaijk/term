PROMPT='$ '

source <(/opt/homebrew/bin/brew shellenv)

# Syntax highlighting should be sourced before the rest.
source $(brew --prefix)/share/zsh-syntax-highlighting/zsh-syntax-highlighting.zsh
source $(brew --prefix)/share/zsh-history-substring-search/zsh-history-substring-search.zsh
source $(brew --prefix)/share/zsh-autosuggestions/zsh-autosuggestions.zsh

function zvm_config() {
  ZVM_INIT_MODE=sourcing
  ZVM_LINE_INIT_MODE=$ZVM_MODE_INSERT
  ZVM_INSERT_MODE_CURSOR=$ZVM_CURSOR_BLINKING_BEAM
  ZVM_NORMAL_MODE_CURSOR=$ZVM_CURSOR_BLINKING_BLOCK
  ZVM_VISUAL_MODE_CURSOR=$ZVM_CURSOR_BLINKING_BLOCK
}

function zvm_after_init() {
  bindkey '^[[A' history-substring-search-up
  bindkey '^[[B' history-substring-search-down
  bindkey -M vicmd 'k' history-substring-search-up
  bindkey -M vicmd 'j' history-substring-search-down
}

source $(brew --prefix)/opt/zsh-vi-mode/share/zsh-vi-mode/zsh-vi-mode.plugin.zsh
export NVM_DIR="$HOME/.nvm"

# Prefer nvm's current Node symlink over Homebrew's linked node formula.
[[ -d "$NVM_DIR/current/bin" ]] && path=("$NVM_DIR/current/bin" ${path:#"$NVM_DIR/current/bin"})

NVM_SCRIPT="$(brew --prefix nvm 2>/dev/null)/nvm.sh"
[[ -r $NVM_SCRIPT ]] && source "$NVM_SCRIPT"
unset NVM_SCRIPT

# Animated eye splash screen
TERM_REPO="${${(%):-%x}:A:h:h:h}"
if [[ -o interactive && -t 0 && -z $ZELLIJ && -r "$TERM_REPO/package.json" ]]; then
  (cd "$TERM_REPO" && bun run splash) 2>/dev/null || true
fi
unset TERM_REPO

# Keep zellij panes on the forwarded SSH agent after reconnects.
function term_refresh_ssh_agent() {
  if [[ -n $SSH_CONNECTION ]]; then
    local stable="$HOME/.ssh/forwarded-agent.sock"
    if [[ -S ${SSH_AUTH_SOCK:-} && $SSH_AUTH_SOCK != "$stable" ]]; then
      mkdir -p "$HOME/.ssh"
      ln -sf "$SSH_AUTH_SOCK" "$stable"
    elif [[ ! -S $stable ]]; then
      local newest=("$HOME"/.ssh/agent/*.sshd.*(N.om[1]))
      [[ -n $newest[1] ]] && ln -sf "$newest[1]" "$stable"
    fi
    [[ -S $stable ]] && export SSH_AUTH_SOCK="$stable"
    return
  fi

  if [[ ! -S ${SSH_AUTH_SOCK:-} ]]; then
    export SSH_AUTH_SOCK="$HOME/Library/Containers/com.maxgoedjen.Secretive.SecretAgent/Data/socket.ssh"
  fi
}
term_refresh_ssh_agent
if (( ${precmd_functions[(Ie)term_refresh_ssh_agent]} == 0 )); then
  precmd_functions+=(term_refresh_ssh_agent)
fi

# Rust toolchain binaries. Prefer rustup shims when present, and fall back to
# the installed Homebrew/rustup-managed toolchain when shims are absent.
[[ -d "$HOME/.cargo/bin" ]] && path=("$HOME/.cargo/bin" ${path:#"$HOME/.cargo/bin"})
[[ -d "$HOME/.rustup/toolchains/1.96.0-aarch64-apple-darwin/bin" ]] && path=("$HOME/.rustup/toolchains/1.96.0-aarch64-apple-darwin/bin" ${path:#"$HOME/.rustup/toolchains/1.96.0-aarch64-apple-darwin/bin"})

# Local binaries take precedence over system-wide installs.
export PATH="$HOME/.local/bin:$PATH"
