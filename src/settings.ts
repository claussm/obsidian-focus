import { App, PluginSettingTab, Setting } from 'obsidian';
import { PluginSettings } from './models/types';
import FocusPlugin from './main';

export class FocusSettingTab extends PluginSettingTab {
  plugin: FocusPlugin;

  constructor(app: App, plugin: FocusPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h2', { text: 'Focus Plugin Settings' });

    // Todo Sources section
    containerEl.createEl('h3', { text: 'Todo Sources' });

    new Setting(containerEl)
      .setName('Daily notes parent folder')
      .setDesc(
        'Parent folder containing year folders (e.g., 2024, 2025) for daily notes. ' +
        'Leave empty if year folders are at vault root.'
      )
      .addText(text =>
        text
          .setPlaceholder('e.g., daily or journals')
          .setValue(this.plugin.settings.dailyNotesParent)
          .onChange(async value => {
            this.plugin.settings.dailyNotesParent = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Backlog files')
      .setDesc('Files to scan for todos (one per line)')
      .addTextArea(text =>
        text
          .setPlaceholder('TODO.md\nBacklog.md')
          .setValue(this.plugin.settings.backlogFiles.join('\n'))
          .onChange(async value => {
            this.plugin.settings.backlogFiles = value
              .split('\n')
              .map(s => s.trim())
              .filter(s => s.length > 0);
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Include folders')
      .setDesc('Additional folders to scan for todos (one per line)')
      .addTextArea(text =>
        text
          .setPlaceholder('projects\nareas')
          .setValue(this.plugin.settings.includeFolders.join('\n'))
          .onChange(async value => {
            this.plugin.settings.includeFolders = value
              .split('\n')
              .map(s => s.trim())
              .filter(s => s.length > 0);
            await this.plugin.saveSettings();
          })
      );

    // Display section
    containerEl.createEl('h3', { text: 'Display' });

    new Setting(containerEl)
      .setName('Default sort')
      .setDesc('How to sort todos before custom priority is applied')
      .addDropdown(dropdown =>
        dropdown
          .addOption('date', 'By date (newest first)')
          .addOption('source', 'By source file')
          .addOption('priority', 'No default sorting')
          .setValue(this.plugin.settings.defaultSort)
          .onChange(async value => {
            this.plugin.settings.defaultSort = value as PluginSettings['defaultSort'];
            await this.plugin.saveSettings();
          })
      );

    // Staleness section
    containerEl.createEl('h3', { text: 'Staleness' });

    containerEl.createEl('p', {
      text: 'Todos that sit untouched accumulate visual staleness indicators. ' +
        'Recommitting to a todo resets its staleness clock.',
      cls: 'setting-item-description',
    });

    new Setting(containerEl)
      .setName('Aging after (days)')
      .setDesc('Days before a subtle age badge appears')
      .addText(text =>
        text
          .setValue(String(this.plugin.settings.stalenessAgingDays))
          .onChange(async value => {
            const n = parseInt(value, 10);
            if (!isNaN(n) && n > 0) {
              this.plugin.settings.stalenessAgingDays = n;
              await this.plugin.saveSettings();
            }
          })
      );

    new Setting(containerEl)
      .setName('Stale after (days)')
      .setDesc('Days before the todo is visually flagged as stale')
      .addText(text =>
        text
          .setValue(String(this.plugin.settings.stalenessStaleDays))
          .onChange(async value => {
            const n = parseInt(value, 10);
            if (!isNaN(n) && n > 0) {
              this.plugin.settings.stalenessStaleDays = n;
              await this.plugin.saveSettings();
            }
          })
      );

    new Setting(containerEl)
      .setName('Neglected after (days)')
      .setDesc('Days before the todo is strongly highlighted as neglected')
      .addText(text =>
        text
          .setValue(String(this.plugin.settings.stalenessNeglectedDays))
          .onChange(async value => {
            const n = parseInt(value, 10);
            if (!isNaN(n) && n > 0) {
              this.plugin.settings.stalenessNeglectedDays = n;
              await this.plugin.saveSettings();
            }
          })
      );
  }
}
