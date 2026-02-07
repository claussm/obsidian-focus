import { ItemView, WorkspaceLeaf, setIcon, MarkdownRenderer } from 'obsidian';
import { ChatMessage, LLMAction, Todo, ConversationData, AVAILABLE_MODELS } from '../models/types';
import { ClaudeAPI } from '../services/ClaudeAPI';
import { ContextBuilder } from '../services/ContextBuilder';
import { TodoWriter } from '../services/TodoWriter';
import FocusPlugin from '../main';

export const LLM_PANEL_VIEW_TYPE = 'focus-llm-panel';

export class LLMPanel extends ItemView {
  private static readonly MAX_PERSISTED_MESSAGES = 50;

  private messages: ChatMessage[] = [];
  private claudeAPI: ClaudeAPI;
  private contextBuilder: ContextBuilder;
  private todoWriter: TodoWriter;
  private isLoading = false;
  private pendingActions: LLMAction[] = [];
  private streamingContent = '';
  private streamingMessageEl: HTMLElement | null = null;
  private messagesContainerEl: HTMLElement | null = null;
  private totalInputTokens = 0;
  private totalOutputTokens = 0;
  private lastContextChars = 0;

  constructor(leaf: WorkspaceLeaf, private plugin: FocusPlugin) {
    super(leaf);
    this.claudeAPI = new ClaudeAPI(plugin.settings.claudeApiKey, plugin.settings.claudeModel);
    this.contextBuilder = new ContextBuilder(this.app, plugin.settings);
    this.todoWriter = new TodoWriter(this.app);
  }

  getViewType(): string {
    return LLM_PANEL_VIEW_TYPE;
  }

  getDisplayText(): string {
    return 'Focus AI';
  }

  getIcon(): string {
    return 'bot';
  }

  async onOpen(): Promise<void> {
    await this.loadConversation();
    this.render();
  }

  async onClose(): Promise<void> {
    await this.saveConversation();
  }

  /**
   * Update settings (called when settings change)
   */
  updateSettings(): void {
    this.claudeAPI.setApiKey(this.plugin.settings.claudeApiKey);
    this.claudeAPI.setModel(this.plugin.settings.claudeModel);
    this.contextBuilder = new ContextBuilder(this.app, this.plugin.settings);
  }

  /**
   * Load conversation from plugin data
   */
  private async loadConversation(): Promise<void> {
    const data = await this.plugin.loadData();
    const conv: ConversationData | undefined = data?.conversation;
    if (conv?.messages) {
      this.messages = conv.messages.map(m => ({
        ...m,
        timestamp: new Date(m.timestamp),
      }));
      this.totalInputTokens = conv.totalInputTokens || 0;
      this.totalOutputTokens = conv.totalOutputTokens || 0;

      // Restore pending actions from the last assistant message
      const lastAssistant = [...this.messages].reverse().find(m => m.role === 'assistant');
      if (lastAssistant?.actions) {
        this.pendingActions = [...lastAssistant.actions];
      }
    }
  }

  /**
   * Save conversation to plugin data
   */
  private async saveConversation(): Promise<void> {
    const data = (await this.plugin.loadData()) || {};
    const messagesToSave = this.messages.slice(-LLMPanel.MAX_PERSISTED_MESSAGES);

    data.conversation = {
      messages: messagesToSave.map(m => ({
        role: m.role,
        content: m.content,
        timestamp: m.timestamp.toISOString(),
        actions: m.actions,
        usage: m.usage,
      })),
      totalInputTokens: this.totalInputTokens,
      totalOutputTokens: this.totalOutputTokens,
      lastUpdated: new Date().toISOString(),
    } as ConversationData;

    await this.plugin.saveData(data);
  }

  /**
   * Format token count for display
   */
  private formatTokenCount(count: number): string {
    if (count >= 1000) {
      return `${(count / 1000).toFixed(1)}k`;
    }
    return count.toString();
  }

  /**
   * Render the panel
   */
  private render(): void {
    const container = this.containerEl.children[1];
    container.empty();
    container.addClass('focus-llm-panel');

    // Header
    const header = container.createDiv({ cls: 'focus-llm-header' });

    const titleGroup = header.createDiv({ cls: 'focus-llm-title-group' });
    titleGroup.createEl('h4', { text: 'Focus AI' });

    // Model badge
    const modelName = AVAILABLE_MODELS.find(m => m.id === this.plugin.settings.claudeModel)?.name
      || this.plugin.settings.claudeModel;
    const modelBadge = titleGroup.createSpan({ cls: 'focus-llm-model-badge' });
    modelBadge.setText(modelName);

    // Token info
    const totalTokens = this.totalInputTokens + this.totalOutputTokens;
    if (totalTokens > 0) {
      const tokenInfo = titleGroup.createSpan({ cls: 'focus-llm-token-info' });
      tokenInfo.setText(`${this.formatTokenCount(totalTokens)} tokens`);
      tokenInfo.setAttribute('aria-label',
        `Input: ${this.totalInputTokens.toLocaleString()} | Output: ${this.totalOutputTokens.toLocaleString()}`);
    }

    // Context size info
    if (this.lastContextChars > 0) {
      const contextInfo = titleGroup.createSpan({ cls: 'focus-llm-context-info' });
      const approxTokens = Math.round(this.lastContextChars / 4);
      contextInfo.setText(`~${this.formatTokenCount(approxTokens)} ctx`);
      contextInfo.setAttribute('aria-label',
        `Context: ~${approxTokens.toLocaleString()} tokens (${this.lastContextChars.toLocaleString()} chars)`);
    }

    const actions = header.createDiv({ cls: 'focus-llm-actions' });

    // Clear chat button
    const clearBtn = actions.createEl('button', { cls: 'focus-icon-btn' });
    setIcon(clearBtn, 'trash-2');
    clearBtn.setAttribute('aria-label', 'Clear chat');
    clearBtn.onclick = async () => {
      this.messages = [];
      this.pendingActions = [];
      this.totalInputTokens = 0;
      this.totalOutputTokens = 0;
      this.lastContextChars = 0;
      await this.saveConversation();
      this.render();
    };

    // Close button
    const closeBtn = actions.createEl('button', { cls: 'focus-icon-btn' });
    setIcon(closeBtn, 'x');
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.onclick = () => this.plugin.closeLLMPanel();

    // Messages area
    const messagesContainer = container.createDiv({ cls: 'focus-llm-messages' });
    this.messagesContainerEl = messagesContainer;

    if (this.messages.length === 0 && !this.streamingContent) {
      const welcome = messagesContainer.createDiv({ cls: 'focus-llm-welcome' });
      welcome.createEl('p', {
        text: "Hi! I'm your Focus assistant. I can help you:",
      });
      const list = welcome.createEl('ul');
      list.createEl('li', { text: 'Prioritize your todos based on context and goals' });
      list.createEl('li', { text: 'Break down complex tasks into subtasks' });
      list.createEl('li', { text: 'Create detailed notes for bigger initiatives' });
      welcome.createEl('p', {
        text: 'What would you like to focus on today?',
      });
    } else {
      for (const message of this.messages) {
        this.renderMessage(messagesContainer, message);
      }

      // Render streaming message if active
      if (this.streamingContent) {
        this.streamingMessageEl = this.renderStreamingMessage(messagesContainer, this.streamingContent);
      }
    }

    // Loading indicator (only show if loading but not yet streaming)
    if (this.isLoading && !this.streamingContent) {
      const loading = container.createDiv({ cls: 'focus-llm-loading' });
      loading.createSpan({ text: 'Thinking...' });
    }

    // Input area
    const inputContainer = container.createDiv({ cls: 'focus-llm-input-container' });

    const textarea = inputContainer.createEl('textarea', {
      cls: 'focus-llm-input',
      attr: { placeholder: 'Ask about your todos...', rows: '3' },
    });

    textarea.onkeydown = async (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        await this.sendMessage(textarea.value);
        textarea.value = '';
      }
    };

    const sendBtn = inputContainer.createEl('button', {
      cls: 'focus-llm-send-btn',
      text: 'Send',
    });
    sendBtn.onclick = async () => {
      await this.sendMessage(textarea.value);
      textarea.value = '';
    };

    // Scroll to bottom
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  /**
   * Render a chat message
   */
  private renderMessage(container: HTMLElement, message: ChatMessage): void {
    const msgEl = container.createDiv({
      cls: `focus-llm-message focus-llm-message-${message.role}`,
    });

    const contentEl = msgEl.createDiv({ cls: 'focus-llm-message-content' });

    if (message.role === 'assistant') {
      // Render markdown for assistant messages
      MarkdownRenderer.renderMarkdown(message.content, contentEl, '', this);

      // Render inline actions if this message has pending actions
      if (message.actions && message.actions.length > 0) {
        const actionsEl = msgEl.createDiv({ cls: 'focus-llm-inline-actions' });
        actionsEl.createEl('div', { cls: 'focus-llm-actions-label', text: 'Suggested actions:' });

        for (const action of message.actions) {
          // Only render if still pending
          if (this.pendingActions.includes(action)) {
            this.renderAction(actionsEl, action);
          }
        }
      }
    } else {
      contentEl.setText(message.content);
    }
  }

  /**
   * Render a streaming message (updates in place as content arrives)
   */
  private renderStreamingMessage(container: HTMLElement, content: string): HTMLElement {
    const msgEl = container.createDiv({
      cls: 'focus-llm-message focus-llm-message-assistant focus-llm-message-streaming',
    });

    const contentEl = msgEl.createDiv({ cls: 'focus-llm-message-content' });

    // Render markdown for the streaming content
    MarkdownRenderer.renderMarkdown(content, contentEl, '', this);

    // Add a streaming cursor indicator
    const cursor = contentEl.createSpan({ cls: 'focus-llm-cursor' });
    cursor.setText('▊');

    return msgEl;
  }

  /**
   * Update the streaming message content without full re-render
   */
  private updateStreamingMessage(content: string): void {
    if (!this.streamingMessageEl) return;

    const contentEl = this.streamingMessageEl.querySelector('.focus-llm-message-content');
    if (!contentEl) return;

    // Clear and re-render
    contentEl.empty();
    MarkdownRenderer.renderMarkdown(content, contentEl as HTMLElement, '', this);

    // Re-add cursor
    const cursor = (contentEl as HTMLElement).createSpan({ cls: 'focus-llm-cursor' });
    cursor.setText('▊');

    // Auto-scroll if user is near bottom
    this.autoScrollIfNeeded();
  }

  /**
   * Check if user is scrolled near the bottom and auto-scroll if so
   */
  private autoScrollIfNeeded(): void {
    if (!this.messagesContainerEl) return;

    const container = this.messagesContainerEl;
    const threshold = 100; // pixels from bottom to trigger auto-scroll
    const isNearBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight < threshold;

    if (isNearBottom) {
      container.scrollTop = container.scrollHeight;
    }
  }

  /**
   * Get todo by ID from the sidebar
   */
  private getTodoById(todoId: string): Todo | undefined {
    const sidebar = this.plugin.getTodoSidebar();
    const todos = sidebar?.getTodos() || [];
    return todos.find(t => t.id === todoId);
  }

  /**
   * Render a pending action with full context
   */
  private renderAction(container: HTMLElement, action: LLMAction): void {
    const actionEl = container.createDiv({ cls: 'focus-llm-action' });

    const infoEl = actionEl.createDiv({ cls: 'focus-llm-action-info' });

    switch (action.type) {
      case 'reorder': {
        infoEl.createDiv({ cls: 'focus-llm-action-type', text: 'Reorder todos' });
        const listEl = infoEl.createDiv({ cls: 'focus-llm-action-details' });
        for (let i = 0; i < Math.min(action.todoIds.length, 5); i++) {
          const todo = this.getTodoById(action.todoIds[i]);
          const itemText = todo ? todo.text : action.todoIds[i];
          listEl.createDiv({ cls: 'focus-llm-action-item', text: `${i + 1}. ${itemText}` });
        }
        if (action.todoIds.length > 5) {
          listEl.createDiv({ cls: 'focus-llm-action-item focus-llm-action-more', text: `...and ${action.todoIds.length - 5} more` });
        }
        break;
      }
      case 'complete': {
        const todo = this.getTodoById(action.todoId);
        infoEl.createDiv({ cls: 'focus-llm-action-type', text: 'Mark complete' });
        infoEl.createDiv({ cls: 'focus-llm-action-details', text: todo ? todo.text : action.todoId });
        break;
      }
      case 'breakdown': {
        const todo = this.getTodoById(action.todoId);
        infoEl.createDiv({ cls: 'focus-llm-action-type', text: `Break down: ${todo ? todo.text : 'todo'}` });
        const listEl = infoEl.createDiv({ cls: 'focus-llm-action-details' });
        for (const subtask of action.subtasks) {
          listEl.createDiv({ cls: 'focus-llm-action-item', text: `• ${subtask}` });
        }
        break;
      }
      case 'spawnNote': {
        const todo = this.getTodoById(action.todoId);
        infoEl.createDiv({ cls: 'focus-llm-action-type', text: `Create note: ${action.title}` });
        if (todo) {
          infoEl.createDiv({ cls: 'focus-llm-action-details', text: `For: ${todo.text}` });
        }
        break;
      }
      case 'addTodo': {
        infoEl.createDiv({ cls: 'focus-llm-action-type', text: 'Add todo' });
        infoEl.createDiv({ cls: 'focus-llm-action-details', text: action.text });
        infoEl.createDiv({ cls: 'focus-llm-action-file', text: `→ ${action.file}` });
        break;
      }
    }

    const buttonsEl = actionEl.createDiv({ cls: 'focus-llm-action-buttons' });

    const applyBtn = buttonsEl.createEl('button', {
      cls: 'focus-action-btn',
      text: 'Apply',
    });
    applyBtn.onclick = async () => {
      await this.applyAction(action);
      this.pendingActions = this.pendingActions.filter(a => a !== action);
      this.render();
    };

    const dismissBtn = buttonsEl.createEl('button', {
      cls: 'focus-action-btn focus-action-dismiss',
      text: 'Dismiss',
    });
    dismissBtn.onclick = () => {
      this.pendingActions = this.pendingActions.filter(a => a !== action);
      this.render();
    };
  }

  /**
   * Send a message to Claude with streaming response
   */
  private async sendMessage(content: string): Promise<void> {
    if (!content.trim() || this.isLoading) return;

    // Add user message
    this.messages.push({
      role: 'user',
      content: content.trim(),
      timestamp: new Date(),
    });

    this.isLoading = true;
    this.streamingContent = '';
    this.streamingMessageEl = null;
    this.render();

    try {
      // Build context
      const context = await this.contextBuilder.buildFullContext();
      this.lastContextChars = context.length;

      // Send to Claude with streaming
      await this.claudeAPI.sendMessageStreaming(
        content.trim(),
        context,
        this.messages.slice(0, -1), // Exclude the message we just added
        {
          onToken: (text: string) => {
            this.streamingContent += text;

            // If we don't have a streaming element yet, render to create it
            if (!this.streamingMessageEl && this.messagesContainerEl) {
              this.streamingMessageEl = this.renderStreamingMessage(
                this.messagesContainerEl,
                this.streamingContent
              );
              this.autoScrollIfNeeded();
            } else {
              // Update existing streaming message
              this.updateStreamingMessage(this.streamingContent);
            }
          },
          onComplete: async (response) => {
            // Add the completed assistant message
            this.messages.push({
              role: 'assistant',
              content: response.message,
              timestamp: new Date(),
              actions: response.actions,
              usage: response.usage,
            });

            // Track token usage
            if (response.usage) {
              this.totalInputTokens += response.usage.inputTokens;
              this.totalOutputTokens += response.usage.outputTokens;
            }

            // Store pending actions
            this.pendingActions = [...this.pendingActions, ...response.actions];

            // Clear streaming state and re-render
            this.isLoading = false;
            this.streamingContent = '';
            this.streamingMessageEl = null;

            // Persist conversation
            await this.saveConversation();

            this.render();
          },
          onError: (error: Error) => {
            // Add error message
            this.messages.push({
              role: 'assistant',
              content: `Error: ${error.message}`,
              timestamp: new Date(),
            });

            this.isLoading = false;
            this.streamingContent = '';
            this.streamingMessageEl = null;
            this.render();
          },
          onRetry: (attempt: number, delayMs: number) => {
            // Update loading indicator to show retry status
            const loadingEl = this.containerEl.querySelector('.focus-llm-loading span');
            if (loadingEl) {
              loadingEl.setText(`Retrying in ${delayMs / 1000}s... (attempt ${attempt}/3)`);
            }
          },
        }
      );
    } catch (error) {
      // Handle any unexpected errors
      this.messages.push({
        role: 'assistant',
        content: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        timestamp: new Date(),
      });

      this.isLoading = false;
      this.streamingContent = '';
      this.streamingMessageEl = null;
      this.render();
    }
  }

  /**
   * Apply an LLM action
   */
  private async applyAction(action: LLMAction): Promise<void> {
    const sidebar = this.plugin.getTodoSidebar();

    switch (action.type) {
      case 'reorder':
        if (sidebar) {
          await sidebar.updatePriorityOrder(action.todoIds);
        }
        break;

      case 'complete':
        const todos = sidebar?.getTodos() || [];
        const todoToComplete = todos.find(t => t.id === action.todoId);
        if (todoToComplete) {
          await this.todoWriter.toggleTodo(todoToComplete);
          await sidebar?.refresh();
        }
        break;

      case 'breakdown':
        const todosForBreakdown = sidebar?.getTodos() || [];
        const todoToBreakdown = todosForBreakdown.find(t => t.id === action.todoId);
        if (todoToBreakdown) {
          await this.todoWriter.addSubtasks(todoToBreakdown, action.subtasks);
          await sidebar?.refresh();
        }
        break;

      case 'spawnNote':
        const todosForSpawn = sidebar?.getTodos() || [];
        const todoToSpawn = todosForSpawn.find(t => t.id === action.todoId);
        if (todoToSpawn) {
          await this.todoWriter.createSpawnedNote(
            todoToSpawn,
            action.title,
            action.content
          );
          await sidebar?.refresh();
        }
        break;

      case 'addTodo':
        await this.todoWriter.addTodo(action.file, action.text);
        await sidebar?.refresh();
        break;
    }
  }
}
