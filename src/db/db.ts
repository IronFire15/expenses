import Dexie, { type EntityTable } from 'dexie'
import type {
  Account,
  Budget,
  Category,
  ImportBatch,
  ImportTemplate,
  LocalMeta,
  Rule,
  Setting,
  Transaction,
} from './types'

export class ExpensesDB extends Dexie {
  accounts!: EntityTable<Account, 'id'>
  transactions!: EntityTable<Transaction, 'id'>
  categories!: EntityTable<Category, 'id'>
  rules!: EntityTable<Rule, 'id'>
  budgets!: EntityTable<Budget, 'id'>
  importTemplates!: EntityTable<ImportTemplate, 'id'>
  importBatches!: EntityTable<ImportBatch, 'id'>
  settings!: EntityTable<Setting, 'id'>
  localMeta!: EntityTable<LocalMeta, 'key'>

  constructor(name = 'expenses') {
    super(name)
    // Only indexed fields are listed here; other fields are stored but not indexed.
    this.version(1).stores({
      accounts: 'id, updatedAt',
      transactions: 'id, accountId, date, categoryId, dedupeHash, importBatchId, updatedAt, *tags',
      categories: 'id, parentId, type, updatedAt',
      rules: 'id, priority, categoryId, updatedAt',
      budgets: 'id, categoryId, updatedAt',
      importTemplates: 'id, updatedAt',
      importBatches: 'id, accountId, importedAt, updatedAt',
      settings: 'id, updatedAt',
      localMeta: 'key',
    })
    // v2: import batches can span several accounts (one PDF = current + savings) and carry a file hash.
    this.version(2).stores({
      importBatches: 'id, *accountIds, fileHash, importedAt, updatedAt',
    })
  }
}

export const db = new ExpensesDB()

/** Tables that are merged through Google Drive sync. `localMeta` is excluded on purpose. */
export const SYNCED_TABLES = [
  'accounts',
  'transactions',
  'categories',
  'rules',
  'budgets',
  'importTemplates',
  'importBatches',
  'settings',
] as const

export type SyncedTableName = (typeof SYNCED_TABLES)[number]
