#!/usr/bin/env bash
set -e

echo "Installing dependencies..."
npm install

echo "Building plugin..."
npm run build

echo "Done. Copy main.js, manifest.json, and styles.css to your vault's .obsidian/plugins/obsidian-focus/ folder."
