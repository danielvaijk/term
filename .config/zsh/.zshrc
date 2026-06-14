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
NVM_SCRIPT="$(brew --prefix nvm 2>/dev/null)/nvm.sh"
[[ -r $NVM_SCRIPT ]] && source "$NVM_SCRIPT"
unset NVM_SCRIPT

# Animated eye splash screen
TERM_REPO="${${(%):-%x}:A:h:h:h}"
if [[ -o interactive && -t 0 && -z $ZELLIJ && -r "$TERM_REPO/package.json" ]]; then
  (cd "$TERM_REPO" && bun run splash) 2>/dev/null || true
fi
unset TERM_REPO

# Route SSH agent requests through Secretive for Touch ID-backed key signing.
# Exception: inside an SSH session that forwarded an agent (ssh -A), use the
# stable symlink that session.ts updates on each connection. This ensures
# shells surviving a reconnect (zellij panes) pick up the fresh socket.
if [[ -n $SSH_CONNECTION && -S ~/.ssh/forwarded-agent.sock ]]; then
  export SSH_AUTH_SOCK="$HOME/.ssh/forwarded-agent.sock"
elif [[ -z $SSH_CONNECTION || ! -S ${SSH_AUTH_SOCK:-} ]]; then
  export SSH_AUTH_SOCK="$HOME/Library/Containers/com.maxgoedjen.Secretive.SecretAgent/Data/socket.ssh"
fi

# Local binaries take precedence over system-wide installs.
export PATH="$HOME/.local/bin:$PATH"
