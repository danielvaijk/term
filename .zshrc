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
source $(brew --prefix nvm)/nvm.sh

# Animated eye splash screen
source ~/home/term/splash.zsh
export PATH="$HOME/.local/bin:$PATH"
