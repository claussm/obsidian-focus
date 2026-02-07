import { App, TFile, TFolder } from 'obsidian';
import { Todo, PluginSettings } from '../models/types';
import { TodoParser } from './TodoParser';

/**
 * Builds context for LLM conversations
 */
export class ContextBuilder {
  private todoParser: TodoParser;

  constructor(private app: App, private settings: PluginSettings, todoParser?: TodoParser) {
    this.todoParser = todoParser || new TodoParser(app);
  }

  /**
   * Find all year folders (e.g., "2024", "2025") under the daily notes parent
   */
  private getYearFolders(): TFolder[] {
    const yearRegex = /^\d{4}$/;
    const parentPath = this.settings.dailyNotesParent;
    const folders: TFolder[] = [];

    const parent = !parentPath
      ? this.app.vault.getRoot()
      : this.app.vault.getAbstractFileByPath(parentPath);

    if (!(parent instanceof TFolder)) {
      return folders;
    }

    for (const child of parent.children) {
      if (child instanceof TFolder && yearRegex.test(child.name)) {
        folders.push(child);
      }
    }

    return folders;
  }

  /**
   * Get all markdown files recursively from a folder
   */
  private getMarkdownFilesRecursively(folder: TFolder): TFile[] {
    const files: TFile[] = [];

    const traverse = (f: TFolder) => {
      for (const child of f.children) {
        if (child instanceof TFile && child.extension === 'md') {
          files.push(child);
        } else if (child instanceof TFolder) {
          traverse(child);
        }
      }
    };

    traverse(folder);
    return files;
  }

  /**
   * Get daily note files from year folders, filtered by contextDaysLimit
   */
  async getDailyNotes(): Promise<TFile[]> {
    const yearFolders = this.getYearFolders();
    const dailyNotes: TFile[] = [];

    for (const folder of yearFolders) {
      const files = this.getMarkdownFilesRecursively(folder);
      dailyNotes.push(...files);
    }

    // Sort by filename (date) descending
    dailyNotes.sort((a, b) => b.basename.localeCompare(a.basename));

    // Apply date limit
    if (this.settings.contextDaysLimit > 0) {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - this.settings.contextDaysLimit);
      const cutoffStr = cutoffDate.toISOString().slice(0, 10); // "YYYY-MM-DD"

      return dailyNotes.filter(f => {
        const dateMatch = f.basename.match(/^(\d{4}-\d{2}-\d{2})/);
        if (!dateMatch) return true; // include non-date files
        return dateMatch[1] >= cutoffStr;
      });
    }

    return dailyNotes;
  }

  /**
   * Get files from a specific folder
   */
  private getFilesInFolder(folderPath: string): TFile[] {
    const folder = this.app.vault.getAbstractFileByPath(folderPath);
    if (!(folder instanceof TFolder)) {
      return [];
    }

    const files: TFile[] = [];
    const traverse = (f: TFolder) => {
      for (const child of f.children) {
        if (child instanceof TFile && child.extension === 'md') {
          files.push(child);
        } else if (child instanceof TFolder) {
          traverse(child);
        }
      }
    };

    traverse(folder);
    return files;
  }

  /**
   * Get notes with the configured context tag
   */
  async getTaggedNotes(): Promise<TFile[]> {
    const tag = this.settings.contextTag;
    if (!tag) return [];

    const tagToSearch = tag.startsWith('#') ? tag : `#${tag}`;
    const files: TFile[] = [];

    for (const file of this.app.vault.getMarkdownFiles()) {
      const content = await this.app.vault.cachedRead(file);
      if (content.includes(tagToSearch)) {
        files.push(file);
      }
    }

    return files;
  }

  /**
   * Get backlog files
   */
  getBacklogFiles(): TFile[] {
    const files: TFile[] = [];

    for (const path of this.settings.backlogFiles) {
      const file = this.app.vault.getAbstractFileByPath(path);
      if (file instanceof TFile) {
        files.push(file);
      }
    }

    return files;
  }

  /**
   * Get all files that should be scanned for todos
   */
  async getTodoSourceFiles(): Promise<TFile[]> {
    const files = new Set<TFile>();

    // Daily notes
    const dailyNotes = await this.getDailyNotes();
    dailyNotes.forEach(f => files.add(f));

    // Backlog files
    this.getBacklogFiles().forEach(f => files.add(f));

    // Include folders
    for (const folder of this.settings.includeFolders) {
      this.getFilesInFolder(folder).forEach(f => files.add(f));
    }

    return Array.from(files);
  }

  /**
   * Get all open todos from configured sources
   */
  async getAllOpenTodos(): Promise<Todo[]> {
    const files = await this.getTodoSourceFiles();
    const allTodos = await this.todoParser.parseFiles(files);
    const flatTodos = this.todoParser.flattenTodos(allTodos, false);

    return flatTodos;
  }

  /**
   * Format todos for LLM context
   */
  private formatTodosForContext(todos: Todo[]): string {
    if (todos.length === 0) {
      return '## Open Todos\n\nNo open todos found.';
    }

    let output = '## Open Todos\n\n';

    for (const todo of todos) {
      const indent = '  '.repeat(todo.indent);
      const tags = todo.tags.length > 0 ? ` ${todo.tags.join(' ')}` : '';
      const link = todo.linkedNote ? ` → [[${todo.linkedNote}]]` : '';
      output += `${indent}- [ ] ${todo.text}${tags}${link}\n`;
      output += `${indent}  Source: ${todo.source.path}:${todo.source.line}\n`;
    }

    return output;
  }

  /**
   * Format a file's content for LLM context
   */
  private async formatFileForContext(file: TFile): Promise<string> {
    const content = await this.app.vault.cachedRead(file);
    return `### ${file.path}\n\n${content}`;
  }

  /**
   * Build the full context for LLM with priority-based character budget
   */
  async buildFullContext(): Promise<string> {
    const maxChars = this.settings.maxContextChars;
    let charCount = 0;
    const sections: string[] = [];
    let wasTruncated = false;

    // Priority 1: All open todos (always included)
    const todos = await this.getAllOpenTodos();
    const todosSection = this.formatTodosForContext(todos);
    charCount += todosSection.length;
    sections.push(todosSection);

    // Priority 2: Recent daily notes
    const dailyNotes = await this.getDailyNotes();
    if (dailyNotes.length > 0 && charCount < maxChars) {
      let dailySection = '## Daily Notes\n\n';
      for (const file of dailyNotes) {
        const fileContent = await this.formatFileForContext(file);
        if (charCount + dailySection.length + fileContent.length > maxChars) {
          wasTruncated = true;
          break;
        }
        dailySection += fileContent + '\n\n';
      }
      charCount += dailySection.length;
      sections.push(dailySection);
    }

    // Priority 3: Tagged notes
    if (charCount < maxChars) {
      const taggedNotes = await this.getTaggedNotes();
      if (taggedNotes.length > 0) {
        let taggedSection = `## Notes with #${this.settings.contextTag}\n\n`;
        for (const file of taggedNotes) {
          const fileContent = await this.formatFileForContext(file);
          if (charCount + taggedSection.length + fileContent.length > maxChars) {
            wasTruncated = true;
            break;
          }
          taggedSection += fileContent + '\n\n';
        }
        charCount += taggedSection.length;
        sections.push(taggedSection);
      }
    }

    // Priority 4: Include folder notes
    if (charCount < maxChars) {
      for (const folder of this.settings.includeFolders) {
        const files = this.getFilesInFolder(folder);
        if (files.length > 0) {
          let folderSection = `## Notes from ${folder}/\n\n`;
          for (const file of files) {
            const fileContent = await this.formatFileForContext(file);
            if (charCount + folderSection.length + fileContent.length > maxChars) {
              wasTruncated = true;
              break;
            }
            folderSection += fileContent + '\n\n';
          }
          charCount += folderSection.length;
          sections.push(folderSection);
        }
        if (wasTruncated) break;
      }
    }

    let result = sections.join('\n---\n\n');

    if (wasTruncated) {
      result += '\n\n---\n\n*[Context was truncated due to size limits. Not all vault content is shown.]*';
    }

    return result;
  }
}
