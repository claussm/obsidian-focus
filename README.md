# Obsidian Focus

A focused todo processing station for Obsidian with LLM-powered prioritization.

## Features

- **Unified Todo List**: Aggregates all `- [ ]` items from daily notes, backlog files, and configured folders into a single sidebar
- **Click to Jump**: Click any todo to open its source file at the exact line
- **Live Sync**: Automatically updates when files change
- **Drag to Prioritize**: Reorder todos with drag-and-drop
- **AI Assistant**: Chat with Claude to help prioritize, break down tasks, and plan your work

## Installation

### From Source

1. Clone this repo into your vault's `.obsidian/plugins/` folder:
   ```bash
   cd /path/to/vault/.obsidian/plugins
   git clone https://github.com/yourusername/obsidian-focus
   ```

2. Install dependencies and build:
   ```bash
   cd obsidian-focus
   npm install
   npm run build
   ```

3. Enable the plugin in Obsidian: Settings → Community plugins → Focus

### Manual Install

1. Download the latest release
2. Extract to `.obsidian/plugins/obsidian-focus/`
3. Enable in Obsidian settings

## Usage

### Todo Sidebar

The Focus sidebar appears in the right panel and shows all your open todos.

- **Check/uncheck** todos directly - changes sync back to source files
- **Click** the todo text to jump to its location
- **Drag** todos to reorder them (priority persists)

### AI Assistant

Press `Cmd+Shift+L` (or click the bot icon) to open the AI panel.

Example prompts:
- "What should I focus on today? I have 2 hours."
- "Help me prioritize these tasks for the week"
- "Break down the 'Launch project' task into subtasks"
- "Create a planning note for the Q1 roadmap todo"

The AI can suggest actions like:
- Reordering your todos
- Adding subtasks to a todo
- Creating new notes linked from todos
- Marking items complete

## Configuration

### Settings

| Setting | Description |
|---------|-------------|
| Daily notes parent | Parent folder for year folders (e.g., `daily`). Leave empty if year folders are at vault root |
| Backlog files | Files to scan for todos (e.g., `TODO.md`) |
| Include folders | Additional folders to include in AI context |
| Context tag | Tag that forces notes into AI context (default: `ai-context`) |
| Claude API Key | Your Anthropic API key |

### Daily Notes Structure

The plugin auto-detects year folders (`2024/`, `2025/`, etc.) containing your daily notes:

```
vault/
├── 2024/
│   └── 2024-12-31.md
├── 2025/
│   └── 2025-01-01.md
```

Or nested under a parent folder:
```
vault/
└── daily/
    ├── 2024/
    └── 2025/
```

## Development

```bash
npm install      # Install dependencies
npm run dev      # Watch mode
npm run build    # Production build
```

## License

MIT
