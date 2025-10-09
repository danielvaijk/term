#!/usr/bin/env zsh

# ZSH configuration
SCRIPT_DIR="${0:A:h}"

ln -sf "$SCRIPT_DIR/.zshrc" ~/.zshrc

# Terminal configuration
defaults write com.mitchellh.ghostty "ApplePressAndHoldEnabled" -bool false
