import { Plugin, WorkspaceLeaf } from 'obsidian';
import { PluginSettings, DEFAULT_SETTINGS } from './models/types';
import { TodoSidebar, TODO_SIDEBAR_VIEW_TYPE } from './views/TodoSidebar';
import { LLMPanel, LLM_PANEL_VIEW_TYPE } from './views/LLMPanel';
import { FocusSettingTab } from './settings';

export default class FocusPlugin extends Plugin {
  settings: PluginSettings = DEFAULT_SETTINGS;
  private todoSidebar: TodoSidebar | null = null;
  private llmPanel: LLMPanel | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();

    // Register views
    this.registerView(TODO_SIDEBAR_VIEW_TYPE, leaf => {
      this.todoSidebar = new TodoSidebar(leaf, this);
      return this.todoSidebar;
    });

    this.registerView(LLM_PANEL_VIEW_TYPE, leaf => {
      this.llmPanel = new LLMPanel(leaf, this);
      return this.llmPanel;
    });

    // Add ribbon icon
    this.addRibbonIcon('check-circle', 'Focus', () => {
      this.activateSidebar();
    });

    // Add commands
    this.addCommand({
      id: 'open-focus-sidebar',
      name: 'Open Focus sidebar',
      callback: () => {
        this.activateSidebar();
      },
    });

    this.addCommand({
      id: 'toggle-llm-panel',
      name: 'Toggle AI assistant',
      hotkeys: [{ modifiers: ['Mod', 'Shift'], key: 'l' }],
      callback: () => {
        this.toggleLLMPanel();
      },
    });

    this.addCommand({
      id: 'refresh-todos',
      name: 'Refresh todo list',
      callback: () => {
        this.todoSidebar?.refresh();
      },
    });

    // Add settings tab
    this.addSettingTab(new FocusSettingTab(this.app, this));

    // Open sidebar on startup
    this.app.workspace.onLayoutReady(() => {
      this.activateSidebar();
    });
  }

  async onunload(): Promise<void> {
    // Cleanup views
    this.app.workspace.detachLeavesOfType(TODO_SIDEBAR_VIEW_TYPE);
    this.app.workspace.detachLeavesOfType(LLM_PANEL_VIEW_TYPE);
  }

  async loadSettings(): Promise<void> {
    const data = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data?.settings);
  }

  async saveSettings(): Promise<void> {
    const data = (await this.loadData()) || {};
    data.settings = this.settings;
    await this.saveData(data);

    // Update LLM panel with new settings
    this.llmPanel?.updateSettings();

    // Refresh sidebar with new settings
    this.todoSidebar?.refresh();
  }

  /**
   * Activate the todo sidebar
   */
  async activateSidebar(): Promise<void> {
    const { workspace } = this.app;

    // Check if already open
    const existing = workspace.getLeavesOfType(TODO_SIDEBAR_VIEW_TYPE);
    if (existing.length > 0) {
      workspace.revealLeaf(existing[0]);
      return;
    }

    // Open in right sidebar
    const leaf = workspace.getRightLeaf(false);
    if (leaf) {
      await leaf.setViewState({
        type: TODO_SIDEBAR_VIEW_TYPE,
        active: true,
      });
      workspace.revealLeaf(leaf);
    }
  }

  /**
   * Toggle the LLM panel
   */
  async toggleLLMPanel(): Promise<void> {
    const { workspace } = this.app;

    // Check if already open
    const existing = workspace.getLeavesOfType(LLM_PANEL_VIEW_TYPE);
    if (existing.length > 0) {
      // Close it
      existing.forEach(leaf => leaf.detach());
      this.llmPanel = null;
      return;
    }

    // Open in bottom (horizontal split)
    const leaf = workspace.getLeaf('split', 'horizontal');
    if (leaf) {
      await leaf.setViewState({
        type: LLM_PANEL_VIEW_TYPE,
        active: true,
      });
      workspace.revealLeaf(leaf);
    }
  }

  /**
   * Close the LLM panel
   */
  closeLLMPanel(): void {
    const existing = this.app.workspace.getLeavesOfType(LLM_PANEL_VIEW_TYPE);
    existing.forEach(leaf => leaf.detach());
    this.llmPanel = null;
  }

  /**
   * Get the todo sidebar instance
   */
  getTodoSidebar(): TodoSidebar | null {
    return this.todoSidebar;
  }
}
