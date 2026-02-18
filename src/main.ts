import { Plugin, WorkspaceLeaf } from 'obsidian';
import { PluginSettings, DEFAULT_SETTINGS } from './models/types';
import { TodoSidebar, TODO_SIDEBAR_VIEW_TYPE } from './views/TodoSidebar';
import { FocusSettingTab } from './settings';

export default class FocusPlugin extends Plugin {
  settings: PluginSettings = DEFAULT_SETTINGS;
  private todoSidebar: TodoSidebar | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.registerView(TODO_SIDEBAR_VIEW_TYPE, leaf => {
      this.todoSidebar = new TodoSidebar(leaf, this);
      return this.todoSidebar;
    });

    this.addRibbonIcon('check-circle', 'Focus', () => {
      this.activateSidebar();
    });

    this.addCommand({
      id: 'open-focus-sidebar',
      name: 'Open Focus sidebar',
      callback: () => {
        this.activateSidebar();
      },
    });

    this.addCommand({
      id: 'refresh-todos',
      name: 'Refresh todo list',
      callback: () => {
        this.todoSidebar?.refresh();
      },
    });

    this.addSettingTab(new FocusSettingTab(this.app, this));

    this.app.workspace.onLayoutReady(() => {
      this.activateSidebar();
    });
  }

  async onunload(): Promise<void> {
    this.app.workspace.detachLeavesOfType(TODO_SIDEBAR_VIEW_TYPE);
  }

  async loadSettings(): Promise<void> {
    const data = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data?.settings);
  }

  async saveSettings(): Promise<void> {
    const data = (await this.loadData()) || {};
    data.settings = this.settings;
    await this.saveData(data);

    this.todoSidebar?.refresh();
  }

  async activateSidebar(): Promise<void> {
    const { workspace } = this.app;

    const existing = workspace.getLeavesOfType(TODO_SIDEBAR_VIEW_TYPE);
    if (existing.length > 0) {
      workspace.revealLeaf(existing[0]);
      return;
    }

    const leaf = workspace.getRightLeaf(false);
    if (leaf) {
      await leaf.setViewState({
        type: TODO_SIDEBAR_VIEW_TYPE,
        active: true,
      });
      workspace.revealLeaf(leaf);
    }
  }
}
