# Obsidian Focus

An Obsidian plugin that aggregates and prioritizes todos from across your vault.

## Project Overview

**Problem**: Obsidian is great for capture and long-form notes, but its UX for processing todos and prioritizing work is clunky. This plugin provides a focused todo sidebar within Obsidian.

**Solution**: An Obsidian plugin with a right sidebar that shows a unified todo list aggregated from your vault.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Obsidian                             │
│                                                             │
│  ┌──────────┐  ┌─────────────────────────────────────────┐  │
│  │ Sidebar  │  │            Main Editor                  │  │
│  │          │  │                                         │  │
│  │ ┌──────┐ │  │   [Your notes as usual]                 │  │
│  │ │ Todo │ │  │                                         │  │
│  │ │ List │ │  │                                         │  │
│  │ │      │ │  │                                         │  │
│  │ │ ☐ A  │ │  │                                         │  │
│  │ │ ☐ B  │ │  │                                         │  │
│  │ └──────┘ │  │                                         │  │
│  └──────────┘  └─────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## Core Features

### Todo Sidebar (always visible)
- Aggregates `- [ ]` items from:
  - Daily notes (auto-detected from year folders like `2024/`, `2025/`)
  - Configured backlog files (e.g., `TODO.md`)
  - Configured include folders
- Click todo text → jumps to source line
- Check/uncheck → writes back to source markdown
- Drag to reorder → persists custom priority
- Drag to nest → groups todos visually under a parent

## File Structure

```
obsidian-focus/
├── manifest.json          # Plugin metadata
├── package.json           # Dependencies
├── tsconfig.json          # TypeScript config
├── esbuild.config.mjs     # Build config
├── styles.css             # Plugin styles
├── src/
│   ├── main.ts            # Plugin entry point
│   ├── settings.ts        # Settings tab
│   ├── models/
│   │   └── types.ts       # Core interfaces
│   ├── views/
│   │   └── TodoSidebar.ts # Right sidebar view
│   └── services/
│       ├── TodoParser.ts  # Extract todos from markdown
│       └── TodoWriter.ts  # Write changes back to files
```

## Data Structures

### Todo Item
```typescript
interface Todo {
  id: string;              // hash of file + line content
  text: string;            // todo text without checkbox
  completed: boolean;      // checkbox state
  source: {
    path: string;          // relative path in vault
    line: number;          // line number (1-indexed)
    originalLine: string;  // full line for writing back
  };
  indent: number;          // nesting level
  children: Todo[];        // nested todos
  tags: string[];          // #tags in text
  linkedNote?: string;     // linked note path
  capturedAt: Date;        // from filename or mtime
}
```

### Plugin Settings
```typescript
interface PluginSettings {
  dailyNotesParent: string;    // "" for root, or folder path
  backlogFiles: string[];      // ["TODO.md"]
  includeFolders: string[];    // ["projects", "areas"]
  defaultSort: 'priority' | 'date' | 'source';
}
```

## Daily Notes Structure

Supports year-folder structure:
```
vault/
├── 2024/
│   ├── 2024-12-30.md
│   └── 2024-12-31.md
├── 2025/
│   ├── 2025-01-01.md
│   └── ...
```

Or nested under a parent:
```
vault/
├── daily/
│   ├── 2024/
│   └── 2025/
```

Configure `dailyNotesParent` in settings (empty for root).

## Development Commands

```bash
# Install dependencies
npm install

# Development (watch mode)
npm run dev

# Production build
npm run build
```

## Installation

1. Build the plugin: `npm run build`
2. Copy `main.js`, `manifest.json`, and `styles.css` to your vault's `.obsidian/plugins/obsidian-focus/` folder
3. Enable the plugin in Obsidian settings

## Commands

| Command | Description |
|---------|-------------|
| Open Focus sidebar | Show todo sidebar |
| Refresh todo list | Re-scan vault for todos |
