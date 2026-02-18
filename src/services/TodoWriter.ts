import { App, TFile } from 'obsidian';
import { Todo } from '../models/types';

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
}
