#!/usr/bin/env zsh

SCRIPT_DIR="${0:A:h:h}"

brew bundle

mkdir -p ~/.config/ghostty

ln -sf "$SCRIPT_DIR/.zshrc" ~/.zshrc
ln -sf "$SCRIPT_DIR/.ghostty" ~/.config/ghostty/config
ln -sf "$SCRIPT_DIR/data/bg.jpg" ~/.config/ghostty/bg.jpg
ln -sf "$SCRIPT_DIR/.tmux.conf" ~/.tmux.conf
mkdir -p ~/.config/lazygit && ln -sf "$SCRIPT_DIR/.config/lazygit/config.yml" ~/.config/lazygit/config.yml

defaults write com.mitchellh.ghostty "ApplePressAndHoldEnabled" -bool false

# ssh
mkdir -p ~/.ssh && chmod 700 ~/.ssh
touch ~/.ssh/config && chmod 600 ~/.ssh/config

if ! grep -qF "Include $SCRIPT_DIR/.ssh/config" ~/.ssh/config; then
  print "Include $SCRIPT_DIR/.ssh/config\n$(< ~/.ssh/config)" > ~/.ssh/config
fi
