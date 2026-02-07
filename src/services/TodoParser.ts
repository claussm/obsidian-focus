import { App, TFile } from 'obsidian';
import { Todo } from '../models/types';

/**
 * Parses markdown files to extract todo items
 */
export class TodoParser {
  private cache: Map<string, { mtime: number; todos: Todo[] }> = new Map();

  constructor(private app: App) {}

  /**
   * Invalidate cache for a specific file
   */
  invalidateFile(filePath: string): void {
    this.cache.delete(filePath);
  }

  /**
   * Clear the entire cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Generate a unique ID for a todo based on file path and content
   */
  private generateId(filePath: string, lineContent: string): string {
    const str = `${filePath}::${lineContent}`;
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(36);
  }

  /**
   * Extract tags from todo text
   */
  private extractTags(text: string): string[] {
    const tagRegex = /#[\w-]+/g;
    return text.match(tagRegex) || [];
  }

  /**
   * Extract linked note from todo text (e.g., "Task [[Note Name]]")
   */
  private extractLinkedNote(text: string): string | undefined {
    const linkRegex = /\[\[([^\]]+)\]\]/;
    const match = text.match(linkRegex);
    return match ? match[1] : undefined;
  }

  /**
   * Calculate indent level from leading whitespace
   */
  private getIndentLevel(line: string): number {
    const match = line.match(/^(\s*)/);
    if (!match) return 0;
    const whitespace = match[1];
    // Count tabs as 1, or every 2-4 spaces as 1 level
    const tabs = (whitespace.match(/\t/g) || []).length;
    const spaces = whitespace.replace(/\t/g, '').length;
    return tabs + Math.floor(spaces / 2);
  }

  /**
   * Parse a single line for a todo item
   */
  private parseLine(
    line: string,
    lineNumber: number,
    filePath: string,
    capturedAt: Date
  ): Todo | null {
    // Match both incomplete and complete checkboxes
    const todoRegex = /^(\s*)- \[([ x])\] (.+)$/;
    const match = line.match(todoRegex);

    if (!match) return null;

    const [, , checkbox, text] = match;
    const completed = checkbox === 'x';
    const indent = this.getIndentLevel(line);

    return {
      id: this.generateId(filePath, line.trim()),
      text: text.trim(),
      completed,
      source: {
        path: filePath,
        line: lineNumber,
        originalLine: line,
      },
      indent,
      children: [],
      tags: this.extractTags(text),
      linkedNote: this.extractLinkedNote(text),
      capturedAt,
    };
  }

  /**
   * Parse a file and extract all todos (with mtime-based caching)
   */
  async parseFile(file: TFile): Promise<Todo[]> {
    const cached = this.cache.get(file.path);
    if (cached && cached.mtime === file.stat.mtime) {
      return cached.todos;
    }

    const content = await this.app.vault.cachedRead(file);
    const lines = content.split('\n');
    const todos: Todo[] = [];
    const stack: Todo[] = []; // For tracking nested todos

    // Try to extract date from daily note filename (e.g., "2025-02-03.md")
    const dateMatch = file.basename.match(/^(\d{4}-\d{2}-\d{2})/);
    const capturedAt = dateMatch
      ? new Date(dateMatch[1])
      : new Date(file.stat.mtime);

    for (let i = 0; i < lines.length; i++) {
      const todo = this.parseLine(lines[i], i + 1, file.path, capturedAt);

      if (!todo) continue;

      // Handle nesting
      if (todo.indent === 0) {
        todos.push(todo);
        stack.length = 0;
        stack.push(todo);
      } else {
        // Find parent at previous indent level
        while (stack.length > 0 && stack[stack.length - 1].indent >= todo.indent) {
          stack.pop();
        }
        if (stack.length > 0) {
          stack[stack.length - 1].children.push(todo);
        } else {
          // No parent found, treat as top-level
          todos.push(todo);
        }
        stack.push(todo);
      }
    }

    this.cache.set(file.path, { mtime: file.stat.mtime, todos });
    return todos;
  }

  /**
   * Parse multiple files and return all todos
   */
  async parseFiles(files: TFile[]): Promise<Todo[]> {
    const allTodos: Todo[] = [];

    for (const file of files) {
      const todos = await this.parseFile(file);
      allTodos.push(...todos);
    }

    return allTodos;
  }

  /**
   * Get all incomplete todos (flattened, including nested)
   */
  flattenTodos(todos: Todo[], includeCompleted = false): Todo[] {
    const result: Todo[] = [];

    const traverse = (items: Todo[]) => {
      for (const todo of items) {
        if (!todo.completed || includeCompleted) {
          result.push(todo);
        }
        if (todo.children.length > 0) {
          traverse(todo.children);
        }
      }
    };

    traverse(todos);
    return result;
  }
}
