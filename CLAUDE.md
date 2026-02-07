# Obsidian Focus

An Obsidian plugin for processing and prioritizing todos with an LLM-powered assistant.

## Project Overview

**Problem**: Obsidian is great for capture and long-form notes, but its UX for processing todos and prioritizing work is clunky. This plugin provides a focused "processing station" within Obsidian.

**Solution**: An Obsidian plugin with:
- Right sidebar: unified todo list aggregated from vault
- Bottom panel: LLM chat interface (toggled) with full vault context

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
│  │ │ List │ │  ├─────────────────────────────────────────┤  │
│  │ │      │ │  │  LLM Panel (toggled via Cmd+Shift+L)    │  │
│  │ │ ☐ A  │ │  │                                         │  │
│  │ │ ☐ B  │ │  │  Chat with Claude about your todos      │  │
│  │ ├──────┤ │  │                                         │  │
│  │ │ [🤖] │ │  │                                         │  │
│  │ └──────┘ │  └─────────────────────────────────────────┘  │
│  └──────────┘                                               │
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

### LLM Panel (toggled)
- Toggle with `Cmd+Shift+L` or sidebar button
- Chat interface with Claude API
- Context includes: all open todos, all dailies, tagged notes, included folders
- LLM can suggest actions:
  - Reorder todos
  - Mark complete
  - Break down into subtasks
  - Spawn new notes with backlinks
  - Add new todos

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
│   │   ├── TodoSidebar.ts # Right sidebar view
│   │   └── LLMPanel.ts    # Bottom panel view
│   └── services/
│       ├── TodoParser.ts  # Extract todos from markdown
│       ├── TodoWriter.ts  # Write changes back to files
│       ├── ContextBuilder.ts # Build LLM context
│       └── ClaudeAPI.ts   # Claude API client
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
  linkedNote?: string;     // spawned note path
  capturedAt: Date;        // from filename or mtime
}
```

### Plugin Settings
```typescript
interface PluginSettings {
  dailyNotesParent: string;    // "" for root, or folder path
  backlogFiles: string[];      // ["TODO.md"]
  includeFolders: string[];    // ["projects", "areas"]
  contextTag: string;          // "ai-context"
  claudeApiKey: string;
  defaultSort: 'priority' | 'date' | 'source';
}
```

## LLM Actions

The LLM can output actions in XML format:

```xml
<action type="reorder">["id1", "id2", "id3"]</action>
<action type="complete">todo-id</action>
<action type="breakdown" todoId="id">
- Subtask 1
- Subtask 2
</action>
<action type="spawnNote" todoId="id" title="Note Title">
Note content here
</action>
<action type="addTodo" file="TODO.md">New todo text</action>
```

Actions appear as suggestions the user can Apply or Dismiss.

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

| Command | Hotkey | Description |
|---------|--------|-------------|
| Open Focus sidebar | — | Show todo sidebar |
| Toggle AI assistant | `Cmd+Shift+L` | Open/close LLM panel |
| Refresh todo list | — | Re-scan vault for todos |
