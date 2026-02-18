import { ItemView, WorkspaceLeaf, TFile, TFolder, setIcon } from 'obsidian';
import { Todo, PluginSettings, PriorityData, NestingData, Section, SectionsData } from '../models/types';
import { TodoParser } from '../services/TodoParser';
import { TodoWriter } from '../services/TodoWriter';
import FocusPlugin from '../main';

export const TODO_SIDEBAR_VIEW_TYPE = 'focus-todo-sidebar';

export class TodoSidebar extends ItemView {
  private todos: Todo[] = [];
  private priorityOrder: string[] = [];
  private nestingData: NestingData = { parentMap: {}, childOrder: {}, updated: '' };
  private sectionsData: SectionsData = { sections: [], assignments: {}, sectionOrder: {} };
  private todoParser: TodoParser;
  private todoWriter: TodoWriter;
  private draggedTodo: Todo | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingRenameId: string | null = null;

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
    await this.loadSectionsData();
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

  private async loadSectionsData(): Promise<void> {
    const data = await this.plugin.loadData();
    if (data?.sections) {
      this.sectionsData = data.sections;
    }
  }

  private async saveSectionsData(): Promise<void> {
    const data = (await this.plugin.loadData()) || {};
    data.sections = this.sectionsData;
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
    this.cleanupStaleData();
    this.sortTodos();
    this.render();
  }

  private cleanupStaleData(): void {
    const validIds = new Set(this.todos.map(t => t.id));
    let nestingChanged = false;
    let sectionsChanged = false;

    // Cleanup stale nesting
    for (const [childId, parentId] of Object.entries(this.nestingData.parentMap)) {
      if (!validIds.has(childId) || !validIds.has(parentId)) {
        delete this.nestingData.parentMap[childId];
        nestingChanged = true;
      }
    }

    for (const [parentId, children] of Object.entries(this.nestingData.childOrder)) {
      const filtered = children.filter(id => validIds.has(id));
      if (filtered.length !== children.length) {
        this.nestingData.childOrder[parentId] = filtered;
        nestingChanged = true;
      }
      if (filtered.length === 0) {
        delete this.nestingData.childOrder[parentId];
      }
    }

    // Cleanup stale section assignments
    for (const todoId of Object.keys(this.sectionsData.assignments)) {
      if (!validIds.has(todoId)) {
        delete this.sectionsData.assignments[todoId];
        sectionsChanged = true;
      }
    }

    for (const [sectionId, order] of Object.entries(this.sectionsData.sectionOrder)) {
      const filtered = order.filter(id => validIds.has(id));
      if (filtered.length !== order.length) {
        this.sectionsData.sectionOrder[sectionId] = filtered;
        sectionsChanged = true;
      }
    }

    if (nestingChanged) this.saveNestingData();
    if (sectionsChanged) this.saveSectionsData();
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

    // Add Section button
    const addSectionBtn = actions.createEl('button', { cls: 'focus-icon-btn' });
    setIcon(addSectionBtn, 'folder-plus');
    addSectionBtn.setAttribute('aria-label', 'Add section');
    addSectionBtn.onclick = () => this.createSection();

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

    const hasSections = this.sectionsData.sections.length > 0;

    if (this.todos.length === 0 && !hasSections) {
      const empty = list.createDiv({ cls: 'focus-empty' });
      empty.setText('No open todos found');
      return;
    }

    const { roots, childrenMap } = this.buildDisplayTree();

    // Split roots by section assignment
    const inboxRoots: Todo[] = [];
    const sectionRootsMap = new Map<string, Todo[]>();
    for (const section of this.sectionsData.sections) {
      sectionRootsMap.set(section.id, []);
    }

    for (const todo of roots) {
      const sectionId = this.sectionsData.assignments[todo.id];
      if (sectionId && sectionRootsMap.has(sectionId)) {
        sectionRootsMap.get(sectionId)!.push(todo);
      } else {
        inboxRoots.push(todo);
      }
    }

    // Sort todos within each section by their section-specific order
    for (const [sectionId, todos] of sectionRootsMap) {
      const order = this.sectionsData.sectionOrder[sectionId] || [];
      todos.sort((a, b) => {
        const aIdx = order.indexOf(a.id);
        const bIdx = order.indexOf(b.id);
        if (aIdx === -1 && bIdx === -1) return 0;
        if (aIdx === -1) return 1;
        if (bIdx === -1) return -1;
        return aIdx - bIdx;
      });
    }

    // Render inbox (unsectioned) area
    if (inboxRoots.length > 0) {
      if (hasSections) {
        const inboxHeader = list.createDiv({ cls: 'focus-inbox-header' });
        inboxHeader.setText('Inbox');
      }
      for (const todo of inboxRoots) {
        this.renderTodoItemNested(list, todo, childrenMap, 0);
      }
    }

    // Render sections
    for (const section of this.sectionsData.sections) {
      this.renderSection(list, section, sectionRootsMap.get(section.id) || [], childrenMap);
    }
  }

  private renderSection(
    container: HTMLElement,
    section: Section,
    todos: Todo[],
    childrenMap: Map<string, Todo[]>
  ): void {
    const sectionEl = container.createDiv({ cls: 'focus-section' });

    // Section header
    const headerEl = sectionEl.createDiv({ cls: 'focus-section-header' });
    headerEl.setAttribute('data-section-id', section.id);

    // Collapse toggle
    const collapseBtn = headerEl.createDiv({ cls: 'focus-section-collapse' });
    setIcon(collapseBtn, section.collapsed ? 'chevron-right' : 'chevron-down');
    collapseBtn.onclick = async (e) => {
      e.stopPropagation();
      section.collapsed = !section.collapsed;
      await this.saveSectionsData();
      this.render();
    };

    // Section name (double-click to rename)
    const nameEl = headerEl.createEl('span', { cls: 'focus-section-name', text: section.name });
    nameEl.ondblclick = (e) => {
      e.stopPropagation();
      this.startRenameSection(section, nameEl);
    };

    // Auto-focus rename if this section was just created
    if (this.pendingRenameId === section.id) {
      this.pendingRenameId = null;
      setTimeout(() => this.startRenameSection(section, nameEl), 0);
    }

    // Count badge
    headerEl.createSpan({ cls: 'focus-section-count', text: `${todos.length}` });

    // Delete button (visible on hover via CSS)
    const deleteBtn = headerEl.createDiv({ cls: 'focus-section-delete focus-icon-btn' });
    setIcon(deleteBtn, 'trash-2');
    deleteBtn.setAttribute('aria-label', 'Delete section');
    deleteBtn.onclick = async (e) => {
      e.stopPropagation();
      await this.deleteSection(section);
    };

    // Section header is a drop zone for assigning todos
    headerEl.ondragover = (e) => {
      if (!this.draggedTodo) return;
      e.preventDefault();
      headerEl.addClass('drag-over-section');
    };
    headerEl.ondragleave = () => headerEl.removeClass('drag-over-section');
    headerEl.ondrop = async (e) => {
      e.preventDefault();
      headerEl.removeClass('drag-over-section');
      if (!this.draggedTodo) return;
      await this.assignToSection(this.draggedTodo, section.id);
    };

    // Section body
    if (!section.collapsed) {
      const bodyEl = sectionEl.createDiv({ cls: 'focus-section-body' });

      if (todos.length === 0) {
        // Empty drop zone
        const emptyEl = bodyEl.createDiv({ cls: 'focus-section-empty' });
        emptyEl.setText('Drop todos here');
        emptyEl.ondragover = (e) => {
          if (!this.draggedTodo) return;
          e.preventDefault();
          emptyEl.addClass('drag-over-section');
        };
        emptyEl.ondragleave = () => emptyEl.removeClass('drag-over-section');
        emptyEl.ondrop = async (e) => {
          e.preventDefault();
          emptyEl.removeClass('drag-over-section');
          if (!this.draggedTodo) return;
          await this.assignToSection(this.draggedTodo, section.id);
        };
      } else {
        for (const todo of todos) {
          this.renderTodoItemNested(bodyEl, todo, childrenMap, 0);
        }
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

  // ==================== //
  // Section Management   //
  // ==================== //

  private async createSection(): Promise<void> {
    const section: Section = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2),
      name: 'New Section',
      collapsed: false,
    };
    this.sectionsData.sections.push(section);
    this.pendingRenameId = section.id;
    await this.saveSectionsData();
    this.render();
  }

  private async deleteSection(section: Section): Promise<void> {
    this.sectionsData.sections = this.sectionsData.sections.filter(s => s.id !== section.id);

    // Return all assigned todos to inbox
    for (const [todoId, sectionId] of Object.entries(this.sectionsData.assignments)) {
      if (sectionId === section.id) {
        delete this.sectionsData.assignments[todoId];
      }
    }
    delete this.sectionsData.sectionOrder[section.id];

    await this.saveSectionsData();
    this.render();
  }

  private startRenameSection(section: Section, nameEl: HTMLElement): void {
    const input = createEl('input', { type: 'text', cls: 'focus-section-name-input' });
    input.value = section.name;
    nameEl.replaceWith(input);
    input.focus();
    input.select();

    let committed = false;
    const commit = async () => {
      if (committed) return;
      committed = true;
      section.name = input.value.trim() || section.name;
      await this.saveSectionsData();
      this.render();
    };

    input.onblur = commit;
    input.onkeydown = (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      if (e.key === 'Escape') { committed = true; this.render(); }
    };
  }

  private async assignToSection(todo: Todo, sectionId: string): Promise<void> {
    // Remove from current section order
    this.removeTodoFromSections(todo.id);
    // Remove from inbox priority order (it's moving to a section)
    this.priorityOrder = this.priorityOrder.filter(id => id !== todo.id);

    // Assign to new section
    this.sectionsData.assignments[todo.id] = sectionId;
    if (!this.sectionsData.sectionOrder[sectionId]) {
      this.sectionsData.sectionOrder[sectionId] = [];
    }
    if (!this.sectionsData.sectionOrder[sectionId].includes(todo.id)) {
      this.sectionsData.sectionOrder[sectionId].push(todo.id);
    }

    await this.saveSectionsData();
    await this.savePriorityOrder();
    this.render();
  }

  // ==================== //
  // Drag & Drop          //
  // ==================== //

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

  private removeTodoFromSections(todoId: string): void {
    const sectionId = this.sectionsData.assignments[todoId];
    if (sectionId && this.sectionsData.sectionOrder[sectionId]) {
      this.sectionsData.sectionOrder[sectionId] =
        this.sectionsData.sectionOrder[sectionId].filter(id => id !== todoId);
    }
    delete this.sectionsData.assignments[todoId];
  }

  private async handleDropReorder(dragged: Todo, target: Todo, position: 'before' | 'after'): Promise<void> {
    const targetParentId = this.nestingData.parentMap[target.id];
    const targetSectionId = this.sectionsData.assignments[target.id] || null;

    // Remove dragged from its current position entirely
    this.removeTodoFromNesting(dragged.id);
    this.removeTodoFromSections(dragged.id);

    if (targetParentId) {
      // Drop beside a nested child — become a sibling (no section change at child level)
      this.nestingData.parentMap[dragged.id] = targetParentId;
      const siblings = this.nestingData.childOrder[targetParentId] || [];
      const targetIdx = siblings.indexOf(target.id);
      const insertIdx = position === 'before' ? targetIdx : targetIdx + 1;
      siblings.splice(insertIdx, 0, dragged.id);
      this.nestingData.childOrder[targetParentId] = siblings;
    } else if (targetSectionId) {
      // Drop beside a todo in a section — move to that section
      this.sectionsData.assignments[dragged.id] = targetSectionId;
      if (!this.sectionsData.sectionOrder[targetSectionId]) {
        this.sectionsData.sectionOrder[targetSectionId] = [];
      }
      const order = this.sectionsData.sectionOrder[targetSectionId];
      const targetIdx = order.indexOf(target.id);
      const insertIdx = position === 'before' ? targetIdx : targetIdx + 1;
      if (targetIdx !== -1) {
        order.splice(insertIdx, 0, dragged.id);
      } else {
        order.push(dragged.id);
      }
    } else {
      // Drop beside an inbox todo — stays in inbox, reorder by priorityOrder
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
    await this.saveSectionsData();
    this.render();
  }

  private async handleDropNest(dragged: Todo, newParent: Todo): Promise<void> {
    if (this.isDescendantOf(newParent.id, dragged.id)) {
      return;
    }

    this.removeTodoFromNesting(dragged.id);
    // Nested children don't hold section assignments — clear it
    this.removeTodoFromSections(dragged.id);

    this.nestingData.parentMap[dragged.id] = newParent.id;
    if (!this.nestingData.childOrder[newParent.id]) {
      this.nestingData.childOrder[newParent.id] = [];
    }
    this.nestingData.childOrder[newParent.id].push(dragged.id);

    await this.saveNestingData();
    await this.savePriorityOrder();
    await this.saveSectionsData();
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

    // Un-nested todo goes to inbox (clear any stale section assignment)
    this.removeTodoFromSections(todoId);

    const parentRootIdx = this.priorityOrder.indexOf(parentId);
    if (parentRootIdx !== -1) {
      this.priorityOrder.splice(parentRootIdx + 1, 0, todoId);
    } else {
      this.priorityOrder.push(todoId);
    }

    await this.saveNestingData();
    await this.savePriorityOrder();
    await this.saveSectionsData();
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
