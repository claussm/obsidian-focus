import { ItemView, WorkspaceLeaf, TFile, TFolder, setIcon, Platform } from 'obsidian';
import { Todo, PluginSettings, PriorityData, NestingData } from '../models/types';
import { TodoParser } from '../services/TodoParser';
import { TodoWriter } from '../services/TodoWriter';
import FocusPlugin from '../main';

export const TODO_SIDEBAR_VIEW_TYPE = 'focus-todo-sidebar';

export class TodoSidebar extends ItemView {
  private todos: Todo[] = [];
  private priorityOrder: string[] = [];
  private nestingData: NestingData = { parentMap: {}, childOrder: {}, updated: '' };
  private todoParser: TodoParser;
  private todoWriter: TodoWriter;
  private draggedTodo: Todo | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(leaf: WorkspaceLeaf, private plugin: FocusPlugin) {
    super(leaf);
    this.todoParser = new TodoParser(this.app);
    this.todoWriter = new TodoWriter(this.app);
  }

  getViewType(): string {
    return TODO_SIDEBAR_VIEW_TYPE;
  }

  getDisplayText(): string {
    return 'Focus';
  }

  getIcon(): string {
    return 'check-circle';
  }

  async onOpen(): Promise<void> {
    await this.loadPriorityOrder();
    await this.loadNestingData();
    await this.refresh();
    this.registerFileEvents();
  }

  async onClose(): Promise<void> {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
  }

  private async loadPriorityOrder(): Promise<void> {
    const data = await this.plugin.loadData();
    if (data?.priorities?.order) {
      this.priorityOrder = data.priorities.order;
    }
  }

  private async savePriorityOrder(): Promise<void> {
    const data = (await this.plugin.loadData()) || {};
    data.priorities = {
      order: this.priorityOrder,
      updated: new Date().toISOString(),
    } as PriorityData;
    await this.plugin.saveData(data);
  }

  private async loadNestingData(): Promise<void> {
    const data = await this.plugin.loadData();
    if (data?.nesting) {
      this.nestingData = data.nesting;
    }
  }

  private async saveNestingData(): Promise<void> {
    const data = (await this.plugin.loadData()) || {};
    data.nesting = {
      ...this.nestingData,
      updated: new Date().toISOString(),
    };
    await this.plugin.saveData(data);
  }

  private registerFileEvents(): void {
    this.registerEvent(
      this.app.vault.on('modify', (file) => {
        if (file instanceof TFile) {
          this.todoParser.invalidateFile(file.path);
        }
        this.debouncedRefresh();
      })
    );

    this.registerEvent(
      this.app.vault.on('create', () => {
        this.debouncedRefresh();
      })
    );

    this.registerEvent(
      this.app.vault.on('delete', (file) => {
        if (file instanceof TFile) {
          this.todoParser.invalidateFile(file.path);
        }
        this.debouncedRefresh();
      })
    );
  }

  private debouncedRefresh(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.refresh();
    }, 300);
  }

  /**
   * Get all files that should be scanned for todos
   */
  private getTodoSourceFiles(): TFile[] {
    const files = new Set<TFile>();

    // Daily notes from year folders
    const yearRegex = /^\d{4}$/;
    const parentPath = this.plugin.settings.dailyNotesParent;
    const parent = !parentPath
      ? this.app.vault.getRoot()
      : this.app.vault.getAbstractFileByPath(parentPath);

    if (parent instanceof TFolder) {
      for (const child of parent.children) {
        if (child instanceof TFolder && yearRegex.test(child.name)) {
          this.collectMarkdownFiles(child, files);
        }
      }
    }

    // Backlog files
    for (const path of this.plugin.settings.backlogFiles) {
      const file = this.app.vault.getAbstractFileByPath(path);
      if (file instanceof TFile) {
        files.add(file);
      }
    }

    // Include folders
    for (const folderPath of this.plugin.settings.includeFolders) {
      const folder = this.app.vault.getAbstractFileByPath(folderPath);
      if (folder instanceof TFolder) {
        this.collectMarkdownFiles(folder, files);
      }
    }

    return Array.from(files);
  }

  private collectMarkdownFiles(folder: TFolder, files: Set<TFile>): void {
    for (const child of folder.children) {
      if (child instanceof TFile && child.extension === 'md') {
        files.add(child);
      } else if (child instanceof TFolder) {
        this.collectMarkdownFiles(child, files);
      }
    }
  }

  async refresh(): Promise<void> {
    const sourceFiles = this.getTodoSourceFiles();
    const allTodos = await this.todoParser.parseFiles(sourceFiles);
    this.todos = this.todoParser.flattenTodos(allTodos, false);
    this.cleanupStaleNesting();
    this.sortTodos();
    this.render();
  }

  private cleanupStaleNesting(): void {
    const validIds = new Set(this.todos.map(t => t.id));
    let changed = false;

    for (const [childId, parentId] of Object.entries(this.nestingData.parentMap)) {
      if (!validIds.has(childId) || !validIds.has(parentId)) {
        delete this.nestingData.parentMap[childId];
        changed = true;
      }
    }

    for (const [parentId, children] of Object.entries(this.nestingData.childOrder)) {
      const filtered = children.filter(id => validIds.has(id));
      if (filtered.length !== children.length) {
        this.nestingData.childOrder[parentId] = filtered;
        changed = true;
      }
      if (filtered.length === 0) {
        delete this.nestingData.childOrder[parentId];
      }
    }

    if (changed) {
      this.saveNestingData();
    }
  }

  private sortTodos(): void {
    const { defaultSort } = this.plugin.settings;

    if (this.priorityOrder.length > 0) {
      this.todos.sort((a, b) => {
        const aIndex = this.priorityOrder.indexOf(a.id);
        const bIndex = this.priorityOrder.indexOf(b.id);

        if (aIndex !== -1 && bIndex !== -1) {
          return aIndex - bIndex;
        }
        if (aIndex !== -1) return -1;
        if (bIndex !== -1) return 1;

        return this.defaultSortCompare(a, b);
      });
    } else {
      this.todos.sort((a, b) => this.defaultSortCompare(a, b));
    }
  }

  private defaultSortCompare(a: Todo, b: Todo): number {
    const { defaultSort } = this.plugin.settings;

    switch (defaultSort) {
      case 'date':
        return b.capturedAt.getTime() - a.capturedAt.getTime();
      case 'source':
        return a.source.path.localeCompare(b.source.path);
      case 'priority':
      default:
        return 0;
    }
  }

  private buildDisplayTree(): { roots: Todo[]; childrenMap: Map<string, Todo[]> } {
    const childrenMap = new Map<string, Todo[]>();
    const roots: Todo[] = [];
    const todoMap = new Map<string, Todo>();

    for (const todo of this.todos) {
      todoMap.set(todo.id, todo);
    }

    for (const todo of this.todos) {
      const parentId = this.nestingData.parentMap[todo.id];
      if (parentId && todoMap.has(parentId)) {
        if (!childrenMap.has(parentId)) {
          childrenMap.set(parentId, []);
        }
        childrenMap.get(parentId)!.push(todo);
      } else {
        roots.push(todo);
      }
    }

    for (const [parentId, children] of childrenMap) {
      const order = this.nestingData.childOrder[parentId] || [];
      children.sort((a, b) => {
        const aIdx = order.indexOf(a.id);
        const bIdx = order.indexOf(b.id);
        if (aIdx === -1 && bIdx === -1) return 0;
        if (aIdx === -1) return 1;
        if (bIdx === -1) return -1;
        return aIdx - bIdx;
      });
    }

    return { roots, childrenMap };
  }

  private render(): void {
    const container = this.containerEl.children[1];
    container.empty();
    container.addClass('focus-sidebar');

    // Header
    const header = container.createDiv({ cls: 'focus-sidebar-header' });
    header.createEl('h4', { text: 'Focus' });

    const actions = header.createDiv({ cls: 'focus-sidebar-actions' });

    // Refresh button
    const refreshBtn = actions.createEl('button', { cls: 'focus-icon-btn' });
    setIcon(refreshBtn, 'refresh-cw');
    refreshBtn.setAttribute('aria-label', 'Refresh');
    refreshBtn.onclick = () => this.refresh();

    // Todo count
    const count = container.createDiv({ cls: 'focus-todo-count' });
    count.setText(`${this.todos.length} open todo${this.todos.length === 1 ? '' : 's'}`);

    // Todo list
    const list = container.createDiv({ cls: 'focus-todo-list' });

    if (this.todos.length === 0) {
      const empty = list.createDiv({ cls: 'focus-empty' });
      empty.setText('No open todos found');
    } else {
      const { roots, childrenMap } = this.buildDisplayTree();
      for (const todo of roots) {
        this.renderTodoItemNested(list, todo, childrenMap, 0);
      }
    }
  }

  private renderTodoItemNested(
    container: HTMLElement,
    todo: Todo,
    childrenMap: Map<string, Todo[]>,
    depth: number
  ): void {
    const item = container.createDiv({ cls: 'focus-todo-item' });
    item.setAttribute('data-id', todo.id);
    item.style.paddingLeft = `${16 + depth * 24}px`;

    // Un-nest button (for nested items)
    if (depth > 0) {
      const unnestBtn = item.createDiv({ cls: 'focus-unnest-btn' });
      setIcon(unnestBtn, 'arrow-left');
      unnestBtn.setAttribute('aria-label', 'Un-nest');
      unnestBtn.onclick = async (e) => {
        e.stopPropagation();
        await this.unnestTodo(todo.id);
      };
    }

    if (Platform.isMobile) {
      // On mobile: show up/down buttons instead of drag handle
      const moveUp = item.createDiv({ cls: 'focus-move-btn' });
      setIcon(moveUp, 'chevron-up');
      moveUp.setAttribute('aria-label', 'Move up');
      moveUp.onclick = async (e) => {
        e.stopPropagation();
        await this.moveTodo(todo, 'up');
      };

      const moveDown = item.createDiv({ cls: 'focus-move-btn' });
      setIcon(moveDown, 'chevron-down');
      moveDown.setAttribute('aria-label', 'Move down');
      moveDown.onclick = async (e) => {
        e.stopPropagation();
        await this.moveTodo(todo, 'down');
      };
    } else {
      // On desktop: drag handle
      item.draggable = true;
      const handle = item.createDiv({ cls: 'focus-drag-handle' });
      setIcon(handle, 'grip-vertical');
    }

    // Checkbox
    const checkbox = item.createEl('input', { type: 'checkbox' });
    checkbox.checked = todo.completed;
    checkbox.onclick = async (e) => {
      e.stopPropagation();
      await this.todoWriter.toggleTodo(todo);
      await this.refresh();
    };

    // Content
    const content = item.createDiv({ cls: 'focus-todo-content' });

    // Text (clickable to jump to source)
    const text = content.createDiv({ cls: 'focus-todo-text' });
    text.setText(todo.text);
    text.onclick = () => this.jumpToSource(todo);

    // Source info
    const source = content.createDiv({ cls: 'focus-todo-source' });
    const filename = todo.source.path.split('/').pop()?.replace(/\.md$/i, '') ?? todo.source.path;
    source.setText(filename);
    source.setAttribute('title', todo.source.path);

    // Tags
    if (todo.tags.length > 0) {
      const tags = content.createDiv({ cls: 'focus-todo-tags' });
      for (const tag of todo.tags) {
        const tagEl = tags.createSpan({ cls: 'focus-tag' });
        tagEl.setText(tag);
      }
    }

    // Drag events (desktop only)
    if (!Platform.isMobile) {
      item.ondragstart = (e) => {
        this.draggedTodo = todo;
        item.addClass('dragging');
        e.dataTransfer?.setData('text/plain', todo.id);
      };

      item.ondragend = () => {
        item.removeClass('dragging');
        this.draggedTodo = null;
      };

      item.ondragover = (e) => {
        e.preventDefault();
        if (!this.draggedTodo || this.draggedTodo.id === todo.id) return;

        const rect = item.getBoundingClientRect();
        const y = e.clientY - rect.top;
        const height = rect.height;

        item.removeClass('drag-over-top', 'drag-over-bottom', 'drag-over-nest');

        if (y < height * 0.25) {
          item.addClass('drag-over-top');
        } else if (y > height * 0.75) {
          item.addClass('drag-over-bottom');
        } else {
          item.addClass('drag-over-nest');
        }
      };

      item.ondragleave = () => {
        item.removeClass('drag-over-top', 'drag-over-bottom', 'drag-over-nest');
      };

      item.ondrop = async (e) => {
        e.preventDefault();
        if (!this.draggedTodo || this.draggedTodo.id === todo.id) return;

        const rect = item.getBoundingClientRect();
        const y = e.clientY - rect.top;
        const height = rect.height;

        item.removeClass('drag-over-top', 'drag-over-bottom', 'drag-over-nest');

        if (y < height * 0.25) {
          await this.handleDropReorder(this.draggedTodo, todo, 'before');
        } else if (y > height * 0.75) {
          await this.handleDropReorder(this.draggedTodo, todo, 'after');
        } else {
          await this.handleDropNest(this.draggedTodo, todo);
        }
      };
    }

    // Render children recursively
    const children = childrenMap.get(todo.id);
    if (children && children.length > 0) {
      for (const child of children) {
        this.renderTodoItemNested(container, child, childrenMap, depth + 1);
      }
    }
  }

  private removeTodoFromNesting(todoId: string): void {
    delete this.nestingData.parentMap[todoId];

    for (const [parentId, children] of Object.entries(this.nestingData.childOrder)) {
      this.nestingData.childOrder[parentId] = children.filter(id => id !== todoId);
      if (this.nestingData.childOrder[parentId].length === 0) {
        delete this.nestingData.childOrder[parentId];
      }
    }

    this.priorityOrder = this.priorityOrder.filter(id => id !== todoId);
  }

  private async handleDropReorder(dragged: Todo, target: Todo, position: 'before' | 'after'): Promise<void> {
    this.removeTodoFromNesting(dragged.id);

    const targetParentId = this.nestingData.parentMap[target.id];

    if (targetParentId) {
      this.nestingData.parentMap[dragged.id] = targetParentId;
      const siblings = this.nestingData.childOrder[targetParentId] || [];
      const targetIdx = siblings.indexOf(target.id);
      const insertIdx = position === 'before' ? targetIdx : targetIdx + 1;
      siblings.splice(insertIdx, 0, dragged.id);
      this.nestingData.childOrder[targetParentId] = siblings;
    } else {
      const targetRootIdx = this.priorityOrder.indexOf(target.id);
      const insertIdx = position === 'before' ? targetRootIdx : targetRootIdx + 1;

      if (targetRootIdx !== -1) {
        this.priorityOrder.splice(insertIdx, 0, dragged.id);
      } else {
        this.priorityOrder.push(dragged.id);
      }
    }

    await this.saveNestingData();
    await this.savePriorityOrder();
    this.render();
  }

  private async handleDropNest(dragged: Todo, newParent: Todo): Promise<void> {
    if (this.isDescendantOf(newParent.id, dragged.id)) {
      return;
    }

    this.removeTodoFromNesting(dragged.id);

    this.nestingData.parentMap[dragged.id] = newParent.id;
    if (!this.nestingData.childOrder[newParent.id]) {
      this.nestingData.childOrder[newParent.id] = [];
    }
    this.nestingData.childOrder[newParent.id].push(dragged.id);

    await this.saveNestingData();
    await this.savePriorityOrder();
    this.render();
  }

  private isDescendantOf(todoId: string, potentialAncestorId: string): boolean {
    let currentId = todoId;
    const visited = new Set<string>();
    while (this.nestingData.parentMap[currentId]) {
      if (visited.has(currentId)) return false;
      visited.add(currentId);
      currentId = this.nestingData.parentMap[currentId];
      if (currentId === potentialAncestorId) return true;
    }
    return false;
  }

  private async unnestTodo(todoId: string): Promise<void> {
    const parentId = this.nestingData.parentMap[todoId];
    if (!parentId) return;

    delete this.nestingData.parentMap[todoId];
    if (this.nestingData.childOrder[parentId]) {
      this.nestingData.childOrder[parentId] =
        this.nestingData.childOrder[parentId].filter(id => id !== todoId);
      if (this.nestingData.childOrder[parentId].length === 0) {
        delete this.nestingData.childOrder[parentId];
      }
    }

    const parentRootIdx = this.priorityOrder.indexOf(parentId);
    if (parentRootIdx !== -1) {
      this.priorityOrder.splice(parentRootIdx + 1, 0, todoId);
    } else {
      this.priorityOrder.push(todoId);
    }

    await this.saveNestingData();
    await this.savePriorityOrder();
    this.render();
  }

  private async moveTodo(todo: Todo, direction: 'up' | 'down'): Promise<void> {
    const parentId = this.nestingData.parentMap[todo.id];

    if (parentId) {
      // Moving within a parent's children
      const siblings = this.nestingData.childOrder[parentId] || [];
      const idx = siblings.indexOf(todo.id);
      if (idx === -1) return;
      const newIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (newIdx < 0 || newIdx >= siblings.length) return;
      siblings.splice(idx, 1);
      siblings.splice(newIdx, 0, todo.id);
      this.nestingData.childOrder[parentId] = siblings;
      await this.saveNestingData();
    } else {
      // Moving in root priority order
      const allRootIds = this.todos
        .filter(t => !this.nestingData.parentMap[t.id])
        .map(t => t.id);

      // Ensure every root item is represented in priorityOrder
      for (const id of allRootIds) {
        if (!this.priorityOrder.includes(id)) {
          this.priorityOrder.push(id);
        }
      }

      const idx = this.priorityOrder.indexOf(todo.id);
      if (idx === -1) return;
      const newIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (newIdx < 0 || newIdx >= this.priorityOrder.length) return;
      this.priorityOrder.splice(idx, 1);
      this.priorityOrder.splice(newIdx, 0, todo.id);
      await this.savePriorityOrder();
    }

    this.sortTodos();
    this.render();
  }

  private async jumpToSource(todo: Todo): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(todo.source.path);
    if (!file) return;

    const leaf = this.app.workspace.getLeaf(false);
    await leaf.openFile(file as any);

    const view = leaf.view as any;
    if (view?.editor) {
      const line = todo.source.line - 1;
      view.editor.setCursor({ line, ch: 0 });
      view.editor.scrollIntoView({ from: { line, ch: 0 }, to: { line, ch: 0 } }, true);
    }
  }
}
