import { App, TFile } from 'obsidian';
import { Todo } from '../models/types';

/** Paths that should never be written to by LLM actions */
const FORBIDDEN_PATH_PREFIXES = ['.obsidian/', '.trash/'];

/**
 * Validate and sanitize a vault file path from untrusted input (e.g. LLM output).
 * Rejects paths that could target Obsidian internals or escape via traversal.
 */
function sanitizeVaultPath(filePath: string): string {
  // Normalize separators and collapse repeated slashes
  let normalized = filePath.replace(/\\/g, '/').replace(/\/+/g, '/');

  // Strip leading slash
  if (normalized.startsWith('/')) {
    normalized = normalized.slice(1);
  }

  // Reject path traversal
  if (normalized.includes('../') || normalized.includes('/..') || normalized === '..') {
    throw new Error(`Invalid file path (path traversal): ${filePath}`);
  }

  // Reject forbidden directories
  for (const prefix of FORBIDDEN_PATH_PREFIXES) {
    if (normalized.startsWith(prefix) || normalized === prefix.slice(0, -1)) {
      throw new Error(`Cannot write to protected path: ${filePath}`);
    }
  }

  // Reject empty or whitespace-only paths
  if (!normalized || !normalized.trim()) {
    throw new Error('File path cannot be empty');
  }

  return normalized;
}

/**
 * Sanitize a note title to prevent path injection via title field.
 * Strips path separators and other problematic characters.
 */
function sanitizeNoteTitle(title: string): string {
  // Remove path separators and null bytes
  let sanitized = title.replace(/[/\\:\0]/g, '-');
  // Collapse whitespace
  sanitized = sanitized.replace(/\s+/g, ' ').trim();

  if (!sanitized) {
    throw new Error('Note title cannot be empty');
  }

  return sanitized;
}

/**
 * Handles writing changes back to markdown files
 */
export class TodoWriter {
  constructor(private app: App) {}

  /**
   * Toggle a todo's completion status in its source file
   */
  async toggleTodo(todo: Todo): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(todo.source.path);
    if (!(file instanceof TFile)) {
      throw new Error(`File not found: ${todo.source.path}`);
    }

    const content = await this.app.vault.read(file);
    const lines = content.split('\n');
    const lineIndex = todo.source.line - 1;

    if (lineIndex < 0 || lineIndex >= lines.length) {
      throw new Error(`Line ${todo.source.line} not found in ${todo.source.path}`);
    }

    const line = lines[lineIndex];

    // Toggle the checkbox
    if (todo.completed) {
      // Mark as incomplete
      lines[lineIndex] = line.replace('- [x]', '- [ ]');
    } else {
      // Mark as complete
      lines[lineIndex] = line.replace('- [ ]', '- [x]');
    }

    await this.app.vault.modify(file, lines.join('\n'));
  }

  /**
   * Add nested subtasks under a todo
   */
  async addSubtasks(todo: Todo, subtasks: string[]): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(todo.source.path);
    if (!(file instanceof TFile)) {
      throw new Error(`File not found: ${todo.source.path}`);
    }

    const content = await this.app.vault.read(file);
    const lines = content.split('\n');
    const lineIndex = todo.source.line - 1;

    if (lineIndex < 0 || lineIndex >= lines.length) {
      throw new Error(`Line ${todo.source.line} not found in ${todo.source.path}`);
    }

    // Determine the indentation for subtasks
    const currentLine = lines[lineIndex];
    const leadingWhitespace = currentLine.match(/^(\s*)/)?.[1] || '';
    const subtaskIndent = leadingWhitespace + '\t';

    // Create subtask lines
    const subtaskLines = subtasks.map(task => `${subtaskIndent}- [ ] ${task}`);

    // Insert after the current line
    lines.splice(lineIndex + 1, 0, ...subtaskLines);

    await this.app.vault.modify(file, lines.join('\n'));
  }

  /**
   * Add a link to a spawned note in the todo
   */
  async addNoteLink(todo: Todo, noteTitle: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(todo.source.path);
    if (!(file instanceof TFile)) {
      throw new Error(`File not found: ${todo.source.path}`);
    }

    const content = await this.app.vault.read(file);
    const lines = content.split('\n');
    const lineIndex = todo.source.line - 1;

    if (lineIndex < 0 || lineIndex >= lines.length) {
      throw new Error(`Line ${todo.source.line} not found in ${todo.source.path}`);
    }

    // Append the link to the todo line
    lines[lineIndex] = lines[lineIndex].trimEnd() + ` [[${noteTitle}]]`;

    await this.app.vault.modify(file, lines.join('\n'));
  }

  /**
   * Create a new note spawned from a todo
   */
  async createSpawnedNote(
    todo: Todo,
    title: string,
    content: string,
    folder?: string
  ): Promise<TFile> {
    const safeTitle = sanitizeNoteTitle(title);
    const targetFolder = folder ? sanitizeVaultPath(folder) : '';
    const filePath = sanitizeVaultPath(
      targetFolder ? `${targetFolder}/${safeTitle}.md` : `${safeTitle}.md`
    );

    // Create the note content with backlink
    const sourceFileName = todo.source.path.replace(/\.md$/, '');
    const noteContent = `# ${title}

Parent:: [[${sourceFileName}]]

---

${content}
`;

    // Create the file
    const newFile = await this.app.vault.create(filePath, noteContent);

    // Add the link to the original todo
    await this.addNoteLink(todo, safeTitle);

    return newFile;
  }

  /**
   * Add a new todo to a file
   */
  async addTodo(filePath: string, text: string): Promise<void> {
    filePath = sanitizeVaultPath(filePath);
    let file = this.app.vault.getAbstractFileByPath(filePath);

    // Create file if it doesn't exist
    if (!file) {
      await this.app.vault.create(filePath, '');
      file = this.app.vault.getAbstractFileByPath(filePath);
    }

    if (!(file instanceof TFile)) {
      throw new Error(`Could not create or access file: ${filePath}`);
    }

    const content = await this.app.vault.read(file);
    const newContent = content.trimEnd() + `\n- [ ] ${text}\n`;

    await this.app.vault.modify(file, newContent);
  }
}
