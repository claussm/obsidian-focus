#!/usr/bin/env bash
set -e

cd "$(dirname "$0")"

echo "Installing dependencies..."
npm install

echo "Building plugin..."
npm run build

echo "Done. Copy main.js, manifest.json, and styles.css to your vault's .obsidian/plugins/obsidian-focus/ folder."
