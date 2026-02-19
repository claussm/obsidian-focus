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
  /** Additional folders to scan for todos */
  includeFolders: string[];
  /** Default sort order for todos */
  defaultSort: 'priority' | 'date' | 'source';
  /** Days before a todo is considered aging */
  stalenessAgingDays: number;
  /** Days before a todo is considered stale */
  stalenessStaleDays: number;
  /** Days before a todo is considered neglected */
  stalenessNeglectedDays: number;
}

export const DEFAULT_SETTINGS: PluginSettings = {
  dailyNotesParent: '',
  backlogFiles: ['TODO.md'],
  includeFolders: [],
  defaultSort: 'date',
  stalenessAgingDays: 3,
  stalenessStaleDays: 7,
  stalenessNeglectedDays: 14,
};

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

export interface Section {
  /** Unique identifier */
  id: string;
  /** Display name */
  name: string;
  /** Whether the section body is collapsed */
  collapsed: boolean;
}

export interface SectionsData {
  /** Ordered list of sections */
  sections: Section[];
  /** Map of todo ID -> section ID for assigned todos */
  assignments: Record<string, string>;
  /** Map of section ID -> ordered todo IDs within that section */
  sectionOrder: Record<string, string[]>;
}

export interface TodoMetadata {
  /** Timestamp when the todo was first seen by the plugin */
  firstSeen: number;
  /** Timestamp of last meaningful interaction (recommit, reorder, re-section) */
  lastInteracted: number;
}

export type StaleTier = 'fresh' | 'aging' | 'stale' | 'neglected';
