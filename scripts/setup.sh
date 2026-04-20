#!/usr/bin/env zsh

SCRIPT_DIR="${0:A:h}"

brew bundle

mkdir ~/.config/ghostty

ln -sf "$SCRIPT_DIR/.zshrc" ~/.zshrc
ln -sf "$SCRIPT_DIR/.ghostty" ~/.config/ghostty/config
ln -sf "$SCRIPT_DIR/bg.jpg" ~/.config/ghostty/bg.jpg
ln -sf "$SCRIPT_DIR/.tmux.conf" ~/.tmux.conf

defaults write com.mitchellh.ghostty "ApplePressAndHoldEnabled" -bool false

# ssh
mkdir -p ~/.ssh && chmod 700 ~/.ssh
touch ~/.ssh/config && chmod 600 ~/.ssh/config

if ! grep -qF "Include $SCRIPT_DIR/.ssh/config" ~/.ssh/config; then
  print "Include $SCRIPT_DIR/.ssh/config\n$(< ~/.ssh/config)" > ~/.ssh/config
fi
