/**
 * Core types for the Focus plugin
 */

export interface Todo {
  /** Unique identifier (hash of file path + line content) */
  id: string;
  /** The todo text without the checkbox */
  text: string;
  /** Whether the checkbox is checked */
  completed: boolean;
  /** Source location in the vault */
  source: {
    /** Relative path to the file in the vault */
    path: string;
    /** Line number (1-indexed) */
    line: number;
    /** Original full line content for writing back */
    originalLine: string;
  };
  /** Indentation level (0 = top level) */
  indent: number;
  /** Child todos (nested checkboxes) */
  children: Todo[];
  /** Tags found in the todo text */
  tags: string[];
  /** Linked note path if this todo spawned a page */
  linkedNote?: string;
  /** When the todo was captured (from file mtime or daily note date) */
  capturedAt: Date;
}

export interface PluginSettings {
  /** Parent folder for daily notes (empty string = vault root) */
  dailyNotesParent: string;
  /** Backlog files to scan for todos */
  backlogFiles: string[];
  /** Additional folders to include in LLM context */
  includeFolders: string[];
  /** Tag that forces a note into LLM context */
  contextTag: string;
  /** Claude API key */
  claudeApiKey: string;
  /** Claude model to use */
  claudeModel: string;
  /** Default sort order for todos */
  defaultSort: 'priority' | 'date' | 'source';
  /** Number of recent daily notes to include in LLM context (0 = all) */
  contextDaysLimit: number;
  /** Maximum characters to include in LLM context */
  maxContextChars: number;
}

export const DEFAULT_SETTINGS: PluginSettings = {
  dailyNotesParent: '',
  backlogFiles: ['TODO.md'],
  includeFolders: [],
  contextTag: 'ai-context',
  claudeApiKey: '',
  claudeModel: 'claude-sonnet-4-20250514',
  defaultSort: 'date',
  contextDaysLimit: 30,
  maxContextChars: 50000,
};

export const AVAILABLE_MODELS = [
  { id: 'claude-haiku-3-5-20241022', name: 'Claude 3.5 Haiku' },
  { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4' },
  { id: 'claude-opus-4-20250514', name: 'Claude Opus 4' },
] as const;

export interface PriorityData {
  /** Ordered list of todo IDs */
  order: string[];
  /** Last updated timestamp */
  updated: string;
}

export interface NestingData {
  /** Map of child todo ID -> parent todo ID */
  parentMap: Record<string, string>;
  /** Map of parent todo ID -> ordered child IDs */
  childOrder: Record<string, string[]>;
  /** Last updated timestamp */
  updated: string;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

/** LLM tool call types */
export type LLMAction =
  | { type: 'reorder'; todoIds: string[] }
  | { type: 'complete'; todoId: string }
  | { type: 'breakdown'; todoId: string; subtasks: string[] }
  | { type: 'spawnNote'; todoId: string; title: string; content: string }
  | { type: 'addTodo'; file: string; text: string };

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  /** Actions the LLM wants to take */
  actions?: LLMAction[];
  /** Token usage for this message exchange */
  usage?: TokenUsage;
}

export interface SerializedChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  actions?: LLMAction[];
  usage?: TokenUsage;
}

export interface ConversationData {
  messages: SerializedChatMessage[];
  totalInputTokens: number;
  totalOutputTokens: number;
  lastUpdated: string;
}
