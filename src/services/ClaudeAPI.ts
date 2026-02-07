import { requestUrl } from 'obsidian';
import { ChatMessage, LLMAction, TokenUsage } from '../models/types';

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';

/**
 * System prompt for the Focus assistant
 */
const SYSTEM_PROMPT = `You are Focus, an AI assistant integrated into an Obsidian plugin that helps users process and prioritize their todos.

You have access to:
- All of the user's open todos from their Obsidian vault
- Their daily notes
- Notes they've tagged for AI context
- Notes from folders they've configured

Your capabilities:
1. **Prioritize**: Help users decide what to work on based on context, deadlines, energy levels, and goals
2. **Break down**: Split complex todos into actionable subtasks
3. **Organize**: Suggest reordering todos based on priority, dependencies, or themes
4. **Spawn notes**: Create new notes for todos that need more detailed planning

When you want to take an action, include it in your response using this format:

<action type="reorder">
["todo-id-1", "todo-id-2", "todo-id-3"]
</action>

<action type="complete">
todo-id-here
</action>

<action type="breakdown" todoId="todo-id-here">
- First subtask
- Second subtask
- Third subtask
</action>

<action type="spawnNote" todoId="todo-id-here" title="Note Title">
Note content goes here. This will be created as a new note
and linked from the original todo.
</action>

<action type="addTodo" file="TODO.md">
New todo text here
</action>

Guidelines:
- Be concise but helpful
- Ask clarifying questions if the user's priorities or constraints are unclear
- Consider time estimates, energy levels, and deadlines when prioritizing
- Suggest breaking down any todo that seems to have multiple steps or is vague
- Don't overwhelm - focus on actionable next steps`;

export interface ClaudeResponse {
  message: string;
  actions: LLMAction[];
  usage?: TokenUsage;
}

export interface StreamCallbacks {
  onToken: (text: string) => void;
  onComplete: (response: ClaudeResponse) => void;
  onError: (error: Error) => void;
  onRetry?: (attempt: number, delayMs: number) => void;
}

/**
 * Claude API client with retry logic and token tracking
 */
export class ClaudeAPI {
  private static readonly RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);
  private static readonly MAX_RETRIES = 3;

  constructor(private apiKey: string, private model: string = 'claude-sonnet-4-20250514') {}

  /**
   * Update the API key
   */
  setApiKey(key: string): void {
    this.apiKey = key;
  }

  /**
   * Update the model
   */
  setModel(model: string): void {
    this.model = model;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private isRetryable(status: number): boolean {
    return ClaudeAPI.RETRYABLE_STATUS_CODES.has(status);
  }

  /**
   * Parse actions from the assistant's response
   */
  private parseActions(content: string): LLMAction[] {
    const actions: LLMAction[] = [];

    // Parse reorder actions
    const reorderRegex = /<action type="reorder">\s*([\s\S]*?)\s*<\/action>/g;
    let match;
    while ((match = reorderRegex.exec(content)) !== null) {
      try {
        const todoIds = JSON.parse(match[1]);
        actions.push({ type: 'reorder', todoIds });
      } catch (e) {
        console.error('Failed to parse reorder action:', e);
      }
    }

    // Parse complete actions
    const completeRegex = /<action type="complete">\s*([\s\S]*?)\s*<\/action>/g;
    while ((match = completeRegex.exec(content)) !== null) {
      actions.push({ type: 'complete', todoId: match[1].trim() });
    }

    // Parse breakdown actions
    const breakdownRegex = /<action type="breakdown" todoId="([^"]+)">\s*([\s\S]*?)\s*<\/action>/g;
    while ((match = breakdownRegex.exec(content)) !== null) {
      const subtasks = match[2]
        .split('\n')
        .map(line => line.replace(/^-\s*/, '').trim())
        .filter(line => line.length > 0);
      actions.push({ type: 'breakdown', todoId: match[1], subtasks });
    }

    // Parse spawnNote actions
    const spawnRegex = /<action type="spawnNote" todoId="([^"]+)" title="([^"]+)">\s*([\s\S]*?)\s*<\/action>/g;
    while ((match = spawnRegex.exec(content)) !== null) {
      actions.push({
        type: 'spawnNote',
        todoId: match[1],
        title: match[2],
        content: match[3].trim(),
      });
    }

    // Parse addTodo actions
    const addTodoRegex = /<action type="addTodo" file="([^"]+)">\s*([\s\S]*?)\s*<\/action>/g;
    while ((match = addTodoRegex.exec(content)) !== null) {
      actions.push({
        type: 'addTodo',
        file: match[1],
        text: match[2].trim(),
      });
    }

    return actions;
  }

  /**
   * Strip action tags from response for display
   */
  private stripActions(content: string): string {
    return content
      .replace(/<action[^>]*>[\s\S]*?<\/action>/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  /**
   * Build the system prompt with vault context
   */
  private buildSystemPrompt(context: string): string {
    return `${SYSTEM_PROMPT}

---

# Current Vault Context

${context}`;
  }

  /**
   * Build the messages array for the API
   */
  private buildMessages(userMessage: string, history: ChatMessage[]) {
    return [
      ...history.map(msg => ({
        role: msg.role as 'user' | 'assistant',
        content: msg.content,
      })),
      {
        role: 'user' as const,
        content: userMessage,
      },
    ];
  }

  /**
   * Send a message to Claude (non-streaming, with retry)
   */
  async sendMessage(
    userMessage: string,
    context: string,
    history: ChatMessage[]
  ): Promise<ClaudeResponse> {
    if (!this.apiKey) {
      throw new Error('Claude API key not configured. Please set it in Focus settings.');
    }

    const messages = this.buildMessages(userMessage, history);
    const systemWithContext = this.buildSystemPrompt(context);
    const body = JSON.stringify({
      model: this.model,
      max_tokens: 4096,
      system: systemWithContext,
      messages,
    });

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= ClaudeAPI.MAX_RETRIES; attempt++) {
      try {
        const response = await requestUrl({
          url: CLAUDE_API_URL,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': this.apiKey,
            'anthropic-version': '2023-06-01',
          },
          body,
        });

        if (response.status !== 200) {
          throw new Error(`API error (${response.status}): Request failed. Check your API key and try again.`);
        }

        const data = response.json;
        const content = data.content[0]?.text || '';
        const usage: TokenUsage | undefined = data.usage
          ? { inputTokens: data.usage.input_tokens, outputTokens: data.usage.output_tokens }
          : undefined;

        return {
          message: this.stripActions(content),
          actions: this.parseActions(content),
          usage,
        };
      } catch (error: any) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Check if this is a retryable error (requestUrl throws with status property)
        const status = error?.status;
        if (status && this.isRetryable(status) && attempt < ClaudeAPI.MAX_RETRIES) {
          const delay = Math.pow(2, attempt) * 1000;
          await this.sleep(delay);
          continue;
        }

        // Non-retryable or last attempt
        if (attempt >= ClaudeAPI.MAX_RETRIES) break;
        if (status && !this.isRetryable(status)) break;
      }
    }

    throw new Error(`Claude API error: ${lastError?.message}`);
  }

  /**
   * Send a message to Claude with streaming response and retry
   */
  async sendMessageStreaming(
    userMessage: string,
    context: string,
    history: ChatMessage[],
    callbacks: StreamCallbacks
  ): Promise<void> {
    if (!this.apiKey) {
      callbacks.onError(new Error('Claude API key not configured. Please set it in Focus settings.'));
      return;
    }

    const messages = this.buildMessages(userMessage, history);
    const systemWithContext = this.buildSystemPrompt(context);

    for (let attempt = 0; attempt <= ClaudeAPI.MAX_RETRIES; attempt++) {
      try {
        const response = await fetch(CLAUDE_API_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': this.apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: this.model,
            max_tokens: 4096,
            system: systemWithContext,
            messages,
            stream: true,
          }),
        });

        if (!response.ok) {
          if (this.isRetryable(response.status) && attempt < ClaudeAPI.MAX_RETRIES) {
            const delay = Math.pow(2, attempt) * 1000;
            callbacks.onRetry?.(attempt + 1, delay);
            await this.sleep(delay);
            continue;
          }
          callbacks.onError(new Error(`API error (${response.status}): Request failed. Check your API key and try again.`));
          return;
        }

        if (!response.body) {
          callbacks.onError(new Error('No response body received'));
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let fullContent = '';
        let buffer = '';
        let inputTokens = 0;
        let outputTokens = 0;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');

          // Keep the last potentially incomplete line in buffer
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              if (data === '[DONE]') continue;

              try {
                const event = JSON.parse(data);

                if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
                  const text = event.delta.text;
                  fullContent += text;
                  callbacks.onToken(text);
                } else if (event.type === 'message_start' && event.message?.usage) {
                  inputTokens = event.message.usage.input_tokens || 0;
                } else if (event.type === 'message_delta' && event.usage) {
                  outputTokens = event.usage.output_tokens || 0;
                } else if (event.type === 'message_stop') {
                  // Stream complete
                } else if (event.type === 'error') {
                  callbacks.onError(new Error(event.error?.message || 'Unknown streaming error'));
                  return;
                }
              } catch (parseError) {
                // Skip lines that aren't valid JSON
              }
            }
          }
        }

        // Process any remaining buffer
        if (buffer.startsWith('data: ')) {
          const data = buffer.slice(6);
          if (data !== '[DONE]') {
            try {
              const event = JSON.parse(data);
              if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
                const text = event.delta.text;
                fullContent += text;
                callbacks.onToken(text);
              } else if (event.type === 'message_delta' && event.usage) {
                outputTokens = event.usage.output_tokens || 0;
              }
            } catch (parseError) {
              // Skip invalid JSON
            }
          }
        }

        // Parse actions and return complete response
        const usage: TokenUsage | undefined = (inputTokens || outputTokens)
          ? { inputTokens, outputTokens }
          : undefined;

        callbacks.onComplete({
          message: this.stripActions(fullContent),
          actions: this.parseActions(fullContent),
          usage,
        });
        return; // Success — don't retry

      } catch (error) {
        if (attempt < ClaudeAPI.MAX_RETRIES) {
          const delay = Math.pow(2, attempt) * 1000;
          callbacks.onRetry?.(attempt + 1, delay);
          await this.sleep(delay);
          continue;
        }
        if (error instanceof Error) {
          callbacks.onError(new Error(`Claude API error: ${error.message}`));
        } else {
          callbacks.onError(new Error('Unknown error occurred'));
        }
        return;
      }
    }
  }
}
