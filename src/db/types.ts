/**
 * Every synced record carries these fields.
 * `updatedAt` + `deleted` (tombstone) let the Drive sync merge per record:
 * the newest `updatedAt` wins, and deletions propagate instead of resurrecting.
 */
export interface BaseRecord {
  id: string
  updatedAt: number // epoch ms
  deleted: boolean
}

/** ISO calendar date, `YYYY-MM-DD`. Sorts correctly as a string. */
export type ISODate = string

/** Money is always stored as integer cents to avoid float rounding errors. */
export type Cents = number

export type AccountType = 'bank' | 'card' | 'cash' | 'savings'

export interface Account extends BaseRecord {
  name: string
  type: AccountType
  currency: string // ISO 4217, e.g. "EUR"
  importTemplateId?: string
  /** Bank name shown in the UI, e.g. "Moey". */
  institution?: string
  /** Stable key used to match statement sections to this account on import, e.g. "moey|PT50…|current". */
  matchKey?: string
}

export interface Transaction extends BaseRecord {
  accountId: string
  /** Value date: when the money actually moved (purchase date for card payments). */
  date: ISODate
  /** Posting date from the statement, if different from `date`. */
  postedDate?: ISODate
  description: string
  /** Negative = money out, positive = money in. */
  amount: Cents
  /** Account balance right after this transaction, when the statement provides it. */
  balanceAfter?: Cents
  categoryId?: string
  /**
   * How the category was set. 'manual' always wins and is never changed by rules.
   * 'transfer' = matched with the opposite side in another own account. Undefined = uncategorized.
   */
  categorySource?: CategorySource
  /** Rule that set the category, when categorySource is 'rule'. */
  ruleId?: string
  tags: string[]
  notes?: string
  importBatchId?: string
  /** Hash of account + date + amount + normalized description (+ occurrence index) for duplicate detection. */
  dedupeHash?: string
  /** Set on split children: id of the original transaction. */
  splitOf?: string
  /**
   * Set on the original of a split. It stays (it carries the bank's balance and dedupe hash)
   * but its parts replace it in every list and total. See `isCounted`.
   */
  split?: boolean
  /** Links the two sides of a transfer between own accounts. */
  transferPairId?: string
  /**
   * Typed in by hand and not yet seen on a bank statement. A later import matches it
   * (same account, same amount, close date) and fills in the bank's details instead of adding a duplicate.
   */
  manual?: boolean
  /** What you typed, kept after an import matched this entry, so undoing that import restores it. */
  manualEntry?: { date: ISODate; description: string }
}

export type CategoryType = 'expense' | 'income' | 'transfer'

export type CategorySource = 'manual' | 'rule' | 'transfer'

export interface Category extends BaseRecord {
  name: string
  parentId?: string
  type: CategoryType
  color: string // hex
  icon?: string // lucide icon name
}

export type RuleField = 'description' | 'amount'
/** `word` = whole words/phrase (so "nos" doesn't match "santos"). Text matching ignores case and accents. */
export type RuleOperator = 'contains' | 'word' | 'startsWith' | 'equals' | 'regex' | 'between'

export type RuleDirection = 'in' | 'out'

export interface Rule extends BaseRecord {
  field: RuleField
  operator: RuleOperator
  pattern: string // for 'between': "min..max" in cents
  categoryId: string
  /** Lower number runs first. Your rules: 100. Built-in merchant rules: 900+. */
  priority: number
  accountId?: string // optional: only apply to one account
  /** Optional: only money in, or only money out. */
  direction?: RuleDirection
  /** Shipped with the app (can still be edited or deleted). */
  builtin?: boolean
}

export interface Budget extends BaseRecord {
  categoryId: string
  monthlyAmount: Cents
  alertAt: number[] // fractions, e.g. [0.8, 1]
}

export type AmountMode = 'single' | 'debitCredit'

export interface ImportTemplate extends BaseRecord {
  bankName: string
  fileType: 'csv' | 'xlsx' | 'pdf'
  headerRow: number // 0-based
  delimiter?: string // CSV only
  dateColumn: string
  dateFormat: string // e.g. "DD/MM/YYYY"
  descriptionColumns: string[] // joined with " "
  amountMode: AmountMode
  amountColumn?: string
  debitColumn?: string
  creditColumn?: string
  decimalSeparator: ',' | '.'
  /** Flip the sign if the bank exports expenses as positive numbers. */
  invertSign: boolean
}

export interface ImportBatch extends BaseRecord {
  accountIds: string[]
  fileName: string
  /** SHA-256 of the file bytes: warns when the exact same file is imported twice. */
  fileHash: string
  bank: string
  periodFrom?: ISODate
  periodTo?: ISODate
  importedAt: number
  rowCount: number
  skippedDuplicates: number
  /** Rows that matched a transaction you typed by hand (updated it instead of adding a new one). */
  matchedManual?: number
}

/** Synced user preferences (one record per key). */
export interface Setting extends BaseRecord {
  value: unknown
}

/** Device-local state that is never synced (sync cursors, Drive file id, etc). */
export interface LocalMeta {
  key: string
  value: unknown
}
