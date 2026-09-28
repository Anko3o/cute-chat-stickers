#!/bin/sh
# Concatenate the packages into dist/ (no bundler, no dependencies). Run after editing anything in packages/.
set -e
cd "$(dirname "$0")"
JS="packages/core/press.js packages/core/drawer.js packages/emoji-bg/emoji-bg.js packages/reactions/reactions.js \
    packages/stickers/render.js packages/stickers/panel.js packages/kaomoji/kaomoji.js packages/core/index.js"
CSS="packages/core/theme.css packages/core/drawer.css packages/emoji-bg/emoji-bg.css packages/reactions/reactions.css \
     packages/stickers/stickers.css packages/kaomoji/kaomoji.css"
mkdir -p dist
{ echo "/*! chat-stickers — long-press where you want it to stick. Built from packages/ by build.sh. MIT (placeholder). */"
  for f in $JS; do printf '\n/* ---- %s ---- */\n' "$f"; cat "$f"; done; } > dist/chat-stickers.js
{ echo "/*! chat-stickers — built from packages/ by build.sh. MIT (placeholder). */"
  for f in $CSS; do printf '\n/* ---- %s ---- */\n' "$f"; cat "$f"; done; } > dist/chat-stickers.css
echo "dist/chat-stickers.js  $(wc -c < dist/chat-stickers.js) bytes"
echo "dist/chat-stickers.css $(wc -c < dist/chat-stickers.css) bytes"
