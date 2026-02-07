import { App, PluginSettingTab, Setting } from 'obsidian';
import { PluginSettings, AVAILABLE_MODELS } from './models/types';
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

    // LLM Context section
    containerEl.createEl('h3', { text: 'LLM Context' });

    const contextNotice = containerEl.createEl('p', {
      cls: 'setting-item-description',
    });
    contextNotice.setText(
      'The AI assistant sends vault content (todos, daily notes, tagged notes, and files from ' +
      'included folders) to the Anthropic API. Review the settings below to control what is shared.'
    );
    contextNotice.style.marginBottom = '12px';
    contextNotice.style.opacity = '0.8';

    new Setting(containerEl)
      .setName('Include folders')
      .setDesc('Additional folders to include in LLM context (one per line)')
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

    new Setting(containerEl)
      .setName('Context tag')
      .setDesc('Tag that forces a note into LLM context (without #)')
      .addText(text =>
        text
          .setPlaceholder('ai-context')
          .setValue(this.plugin.settings.contextTag)
          .onChange(async value => {
            this.plugin.settings.contextTag = value.trim().replace(/^#/, '');
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Daily notes limit')
      .setDesc('Number of recent days of daily notes to include in LLM context (0 = all)')
      .addText(text =>
        text
          .setPlaceholder('30')
          .setValue(String(this.plugin.settings.contextDaysLimit))
          .onChange(async value => {
            const num = parseInt(value, 10);
            this.plugin.settings.contextDaysLimit = isNaN(num) ? 30 : Math.max(0, num);
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Max context size')
      .setDesc('Maximum characters to include in LLM context (approximate)')
      .addText(text =>
        text
          .setPlaceholder('50000')
          .setValue(String(this.plugin.settings.maxContextChars))
          .onChange(async value => {
            const num = parseInt(value, 10);
            this.plugin.settings.maxContextChars = isNaN(num) ? 50000 : Math.max(1000, num);
            await this.plugin.saveSettings();
          })
      );

    // API section
    containerEl.createEl('h3', { text: 'Claude API' });

    const apiNotice = containerEl.createEl('p', {
      cls: 'setting-item-description',
    });
    apiNotice.setText(
      'Your API key is stored in this plugin\'s data.json file (unencrypted). ' +
      'If you sync your vault (iCloud, Dropbox, etc.), the key will be included. ' +
      'data.json is excluded from git via .gitignore.'
    );
    apiNotice.style.marginBottom = '12px';
    apiNotice.style.opacity = '0.8';

    new Setting(containerEl)
      .setName('API Key')
      .setDesc('Your Anthropic API key for Claude')
      .addText(text =>
        text
          .setPlaceholder('sk-ant-...')
          .setValue(this.plugin.settings.claudeApiKey)
          .onChange(async value => {
            this.plugin.settings.claudeApiKey = value.trim();
            await this.plugin.saveSettings();
          })
      )
      .then(setting => {
        // Make the input a password field
        const input = setting.controlEl.querySelector('input');
        if (input) {
          input.type = 'password';
        }
      });

    new Setting(containerEl)
      .setName('Model')
      .setDesc('Claude model to use for AI assistant')
      .addDropdown(dropdown => {
        for (const model of AVAILABLE_MODELS) {
          dropdown.addOption(model.id, model.name);
        }
        dropdown
          .setValue(this.plugin.settings.claudeModel)
          .onChange(async value => {
            this.plugin.settings.claudeModel = value;
            await this.plugin.saveSettings();
          });
      });

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
  }
}
