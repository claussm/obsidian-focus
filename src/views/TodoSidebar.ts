import { ItemView, WorkspaceLeaf, TFile, setIcon } from 'obsidian';
import { Todo, PluginSettings, PriorityData, NestingData } from '../models/types';
import { TodoParser } from '../services/TodoParser';
import { TodoWriter } from '../services/TodoWriter';
import { ContextBuilder } from '../services/ContextBuilder';
import FocusPlugin from '../main';

export const TODO_SIDEBAR_VIEW_TYPE = 'focus-todo-sidebar';

export class TodoSidebar extends ItemView {
  private todos: Todo[] = [];
  private priorityOrder: string[] = [];
  private nestingData: NestingData = { parentMap: {}, childOrder: {}, updated: '' };
  private todoParser: TodoParser;
  private todoWriter: TodoWriter;
  private contextBuilder: ContextBuilder;
  private draggedTodo: Todo | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(leaf: WorkspaceLeaf, private plugin: FocusPlugin) {
    super(leaf);
    this.todoParser = new TodoParser(this.app);
    this.todoWriter = new TodoWriter(this.app);
    this.contextBuilder = new ContextBuilder(this.app, plugin.settings);
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

  /**
   * Load priority order from plugin data
   */
  private async loadPriorityOrder(): Promise<void> {
    const data = await this.plugin.loadData();
    if (data?.priorities?.order) {
      this.priorityOrder = data.priorities.order;
    }
  }

  /**
   * Save priority order to plugin data
   */
  private async savePriorityOrder(): Promise<void> {
    const data = (await this.plugin.loadData()) || {};
    data.priorities = {
      order: this.priorityOrder,
      updated: new Date().toISOString(),
    } as PriorityData;
    await this.plugin.saveData(data);
  }

  /**
   * Load nesting data from plugin data
   */
  private async loadNestingData(): Promise<void> {
    const data = await this.plugin.loadData();
    if (data?.nesting) {
      this.nestingData = data.nesting;
    }
  }

  /**
   * Save nesting data to plugin data
   */
  private async saveNestingData(): Promise<void> {
    const data = (await this.plugin.loadData()) || {};
    data.nesting = {
      ...this.nestingData,
      updated: new Date().toISOString(),
    };
    await this.plugin.saveData(data);
  }

  /**
   * Register file change events with debouncing
   */
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

  /**
   * Debounced refresh — waits 300ms after last event before refreshing
   */
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
   * Refresh the todo list
   */
  async refresh(): Promise<void> {
    this.contextBuilder = new ContextBuilder(this.app, this.plugin.settings, this.todoParser);
    this.todos = await this.contextBuilder.getAllOpenTodos();
    this.cleanupStaleNesting();
    this.sortTodos();
    this.render();
  }

  /**
   * Remove nesting entries for todos that no longer exist
   */
  private cleanupStaleNesting(): void {
    const validIds = new Set(this.todos.map(t => t.id));
    let changed = false;

    // Remove parentMap entries where child or parent no longer exists
    for (const [childId, parentId] of Object.entries(this.nestingData.parentMap)) {
      if (!validIds.has(childId) || !validIds.has(parentId)) {
        delete this.nestingData.parentMap[childId];
        changed = true;
      }
    }

    // Clean childOrder
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
      this.saveNestingData(); // fire and forget
    }
  }

  /**
   * Sort todos based on priority order or default sort
   */
  private sortTodos(): void {
    const { defaultSort } = this.plugin.settings;

    if (this.priorityOrder.length > 0) {
      // Sort by priority order
      this.todos.sort((a, b) => {
        const aIndex = this.priorityOrder.indexOf(a.id);
        const bIndex = this.priorityOrder.indexOf(b.id);

        // Items in priority list come first
        if (aIndex !== -1 && bIndex !== -1) {
          return aIndex - bIndex;
        }
        if (aIndex !== -1) return -1;
        if (bIndex !== -1) return 1;

        // Fall back to default sort for unordered items
        return this.defaultSortCompare(a, b);
      });
    } else {
      this.todos.sort((a, b) => this.defaultSortCompare(a, b));
    }
  }

  /**
   * Default sort comparison
   */
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

  /**
   * Update priority order (called from LLM actions)
   */
  async updatePriorityOrder(todoIds: string[]): Promise<void> {
    this.priorityOrder = todoIds;
    await this.savePriorityOrder();
    this.sortTodos();
    this.render();
  }

  /**
   * Get current todos (for LLM context)
   */
  getTodos(): Todo[] {
    return this.todos;
  }

  /**
   * Build a display tree from the flat todo list using nesting data
   */
  private buildDisplayTree(): { roots: Todo[]; childrenMap: Map<string, Todo[]> } {
    const childrenMap = new Map<string, Todo[]>();
    const roots: Todo[] = [];
    const todoMap = new Map<string, Todo>();

    // Index all todos by ID
    for (const todo of this.todos) {
      todoMap.set(todo.id, todo);
    }

    // Separate roots from nested
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

    // Sort children by childOrder
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

  /**
   * Render the sidebar
   */
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

    // LLM toggle button
    const llmBtn = actions.createEl('button', { cls: 'focus-icon-btn focus-llm-btn' });
    setIcon(llmBtn, 'bot');
    llmBtn.setAttribute('aria-label', 'Open AI Assistant');
    llmBtn.onclick = () => this.plugin.toggleLLMPanel();

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

  /**
   * Render a todo item with nesting support
   */
  private renderTodoItemNested(
    container: HTMLElement,
    todo: Todo,
    childrenMap: Map<string, Todo[]>,
    depth: number
  ): void {
    const item = container.createDiv({ cls: 'focus-todo-item' });
    item.setAttribute('data-id', todo.id);
    item.style.paddingLeft = `${16 + depth * 24}px`;
    item.draggable = true;

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

    // Drag handle
    const handle = item.createDiv({ cls: 'focus-drag-handle' });
    setIcon(handle, 'grip-vertical');

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

    // Source info — show filename without extension, full path on hover
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

    // Drag events
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

      // Three-zone drop detection based on cursor Y position
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

    // Render children recursively
    const children = childrenMap.get(todo.id);
    if (children && children.length > 0) {
      for (const child of children) {
        this.renderTodoItemNested(container, child, childrenMap, depth + 1);
      }
    }
  }

  /**
   * Remove a todo from its current nesting position
   */
  private removeTodoFromNesting(todoId: string): void {
    // Remove from parentMap
    delete this.nestingData.parentMap[todoId];

    // Remove from all childOrder lists
    for (const [parentId, children] of Object.entries(this.nestingData.childOrder)) {
      this.nestingData.childOrder[parentId] = children.filter(id => id !== todoId);
      if (this.nestingData.childOrder[parentId].length === 0) {
        delete this.nestingData.childOrder[parentId];
      }
    }

    // Remove from root priority order
    this.priorityOrder = this.priorityOrder.filter(id => id !== todoId);
  }

  /**
   * Handle drop as reorder (before or after target)
   */
  private async handleDropReorder(dragged: Todo, target: Todo, position: 'before' | 'after'): Promise<void> {
    this.removeTodoFromNesting(dragged.id);

    const targetParentId = this.nestingData.parentMap[target.id];

    if (targetParentId) {
      // Target is nested — insert dragged as sibling under same parent
      this.nestingData.parentMap[dragged.id] = targetParentId;
      const siblings = this.nestingData.childOrder[targetParentId] || [];
      const targetIdx = siblings.indexOf(target.id);
      const insertIdx = position === 'before' ? targetIdx : targetIdx + 1;
      siblings.splice(insertIdx, 0, dragged.id);
      this.nestingData.childOrder[targetParentId] = siblings;
    } else {
      // Target is at root level — reorder in priorityOrder
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

  /**
   * Handle drop as nesting (make dragged a child of target)
   */
  private async handleDropNest(dragged: Todo, newParent: Todo): Promise<void> {
    // Prevent circular nesting
    if (this.isDescendantOf(newParent.id, dragged.id)) {
      return;
    }

    this.removeTodoFromNesting(dragged.id);

    // Nest under new parent
    this.nestingData.parentMap[dragged.id] = newParent.id;
    if (!this.nestingData.childOrder[newParent.id]) {
      this.nestingData.childOrder[newParent.id] = [];
    }
    this.nestingData.childOrder[newParent.id].push(dragged.id);

    await this.saveNestingData();
    await this.savePriorityOrder();
    this.render();
  }

  /**
   * Check if todoId is a descendant of potentialAncestorId in nesting data
   */
  private isDescendantOf(todoId: string, potentialAncestorId: string): boolean {
    let currentId = todoId;
    const visited = new Set<string>();
    while (this.nestingData.parentMap[currentId]) {
      if (visited.has(currentId)) return false; // cycle protection
      visited.add(currentId);
      currentId = this.nestingData.parentMap[currentId];
      if (currentId === potentialAncestorId) return true;
    }
    return false;
  }

  /**
   * Un-nest a todo (move back to root level after its former parent)
   */
  private async unnestTodo(todoId: string): Promise<void> {
    const parentId = this.nestingData.parentMap[todoId];
    if (!parentId) return;

    // Remove from parent
    delete this.nestingData.parentMap[todoId];
    if (this.nestingData.childOrder[parentId]) {
      this.nestingData.childOrder[parentId] =
        this.nestingData.childOrder[parentId].filter(id => id !== todoId);
      if (this.nestingData.childOrder[parentId].length === 0) {
        delete this.nestingData.childOrder[parentId];
      }
    }

    // Add to root priority order after the former parent
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

  /**
   * Jump to todo source in editor
   */
  private async jumpToSource(todo: Todo): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(todo.source.path);
    if (!file) return;

    const leaf = this.app.workspace.getLeaf(false);
    await leaf.openFile(file as any);

    // Scroll to line
    const view = leaf.view as any;
    if (view?.editor) {
      const line = todo.source.line - 1;
      view.editor.setCursor({ line, ch: 0 });
      view.editor.scrollIntoView({ from: { line, ch: 0 }, to: { line, ch: 0 } }, true);
    }
  }
}
