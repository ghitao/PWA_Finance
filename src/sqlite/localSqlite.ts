import initSqlJs, { type QueryExecResult, type SqlJsStatic } from 'sql.js'
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url'

export type LocalSqliteInfo = {
  sqliteVersion: string
  tableNames: string[]
  latestTransactions: TransactionsPreview | null
}

export type TransactionsPreview = {
  columns: string[]
  rows: string[][]
  orderedBy: string
  offset: number
  limit: number
  totalRows: number
  sumTrValueBase: number
  sumTrValueRef: number
  availableTrTypes: string[]
  availableTrEvents: string[]
  availableAccounts: string[]
  availableCategories: string[]
}

export type InspectLocalSqliteOptions = {
  transactionsOffset?: number
  transactionsLimit?: number
  transactionsTypeFilter?: string
  transactionsEventFilter?: string
  transactionsAccountFilter?: string
  transactionsCategoryFilter?: string
  transactionsDescriptionFilter?: string
  transactionsFromDate?: string
  transactionsToDate?: string
  transactionsSortColumn?: 'date' | 'value'
  transactionsSortDirection?: 'asc' | 'desc'
}

let sqlJsLoader: Promise<SqlJsStatic> | null = null

const SQLITE_HEADER = 'SQLite format 3\u0000'

function hasSqliteHeader(data: Uint8Array): boolean {
  if (data.length < SQLITE_HEADER.length) {
    return false
  }

  const headerText = new TextDecoder().decode(data.subarray(0, SQLITE_HEADER.length))
  return headerText === SQLITE_HEADER
}

async function getSqlJs(): Promise<SqlJsStatic> {
  if (!sqlJsLoader) {
    sqlJsLoader = initSqlJs({
      locateFile: () => wasmUrl,
    })
  }

  return sqlJsLoader
}

function getSingleValue(result: QueryExecResult[], fallback: string): string {
  if (!result[0] || !result[0].values[0] || result[0].values[0][0] === undefined) {
    return fallback
  }

  return String(result[0].values[0][0])
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`
}

function quoteSqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

function normalizeValue(value: unknown): string {
  if (value === null || value === undefined) {
    return ''
  }

  if (typeof value === 'object') {
    return JSON.stringify(value)
  }

  return String(value)
}

function getColumnNamesFromPragma(result: QueryExecResult[]): string[] {
  if (!result[0]) {
    return []
  }

  return result[0].values
    .map((row) => String(row[1] ?? ''))
    .filter((name) => name.length > 0)
}

function getOrderCandidates(columnNames: string[]): string[] {
  const preferredOrderColumns = [
    'trDate',
    'tr_date',
    'created_at',
    'createdAt',
    'inserted_at',
    'timestamp',
    'transaction_date',
    'date',
    'id',
  ]

  const matches = preferredOrderColumns
    .map((preferredName) =>
      columnNames.find((columnName) => columnName.toLowerCase() === preferredName.toLowerCase()),
    )
    .filter((name): name is string => Boolean(name))

  const fallbackColumn = columnNames[0] ? [columnNames[0]] : []

  return [...new Set([...matches, ...fallbackColumn, 'rowid'])]
}

function getDistinctValues(
  db: InstanceType<SqlJsStatic['Database']>,
  tableName: string,
  columnName: string,
  alias: string,
): string[] {
  return (
    db.exec(
      `SELECT DISTINCT ${quoteIdentifier(columnName)} AS ${quoteIdentifier(alias)} FROM ${quoteIdentifier(tableName)} WHERE ${quoteIdentifier(columnName)} IS NOT NULL AND TRIM(CAST(${quoteIdentifier(columnName)} AS TEXT)) <> '' ORDER BY ${quoteIdentifier(columnName)} ASC;`,
    )[0]?.values
      .map((row) => String(row[0]))
      .filter((value) => value.length > 0) ?? []
  )
}

function normalizeDistinctValues(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))]
}

function loadAvailableValuesFromSettings(
  db: InstanceType<SqlJsStatic['Database']>,
  settingType: string,
  alias: string,
): string[] {
  const settingsTableResult = db.exec(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND lower(name) = 'settings' LIMIT 1;",
  )
  const settingsTableName = settingsTableResult[0]?.values[0]?.[0]

  if (!settingsTableName) {
    return []
  }

  const tableName = String(settingsTableName)
  const pragmaResult = db.exec(`PRAGMA table_info(${quoteIdentifier(tableName)});`)
  const settingsColumns = getColumnNamesFromPragma(pragmaResult)
  const typeColumn = settingsColumns.find((columnName) => columnName.toLowerCase() === 'type')

  if (!typeColumn) {
    return []
  }

  const valueColumnCandidates = ['value', 'name', 'account', 'data', 'settingvalue']
  const valueColumn =
    valueColumnCandidates
      .map((candidate) =>
        settingsColumns.find((columnName) => columnName.toLowerCase() === candidate.toLowerCase()),
      )
      .find((columnName): columnName is string => Boolean(columnName)) ??
    settingsColumns.find((columnName) => columnName.toLowerCase() !== 'type')

  if (!valueColumn) {
    return []
  }

  const rawValues =
    db.exec(
      `SELECT DISTINCT ${quoteIdentifier(valueColumn)} AS ${quoteIdentifier(alias)} FROM ${quoteIdentifier(tableName)} WHERE lower(trim(CAST(${quoteIdentifier(typeColumn)} AS TEXT))) = ${quoteSqlString(settingType.toLowerCase())} AND ${quoteIdentifier(valueColumn)} IS NOT NULL AND TRIM(CAST(${quoteIdentifier(valueColumn)} AS TEXT)) <> '' ORDER BY ${quoteIdentifier(valueColumn)} ASC;`,
    )[0]?.values.map((row) => String(row[0])) ?? []

  return normalizeDistinctValues(rawValues)
}

function loadAvailableAccountsFromSettings(db: InstanceType<SqlJsStatic['Database']>): string[] {
  return loadAvailableValuesFromSettings(db, 'accounts', 'account')
}

function loadAvailableCategoriesFromSettings(db: InstanceType<SqlJsStatic['Database']>): string[] {
  return loadAvailableValuesFromSettings(db, 'categories', 'category')
}

function loadLatestTransactions(
  db: InstanceType<SqlJsStatic['Database']>,
  offset: number,
  limit: number,
  trTypeFilter?: string,
  trEventFilter?: string,
  accountFilter?: string,
  categoryFilter?: string,
  descriptionFilter?: string,
  fromDateFilter?: string,
  toDateFilter?: string,
  sortColumn: 'date' | 'value' = 'date',
  sortDirection: 'asc' | 'desc' = 'desc',
): TransactionsPreview | null {
  const tableExistsResult = db.exec(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND lower(name) = 'transactions' LIMIT 1;",
  )

  const tableName = tableExistsResult[0]?.values[0]?.[0]

  if (!tableName) {
    return null
  }

  const tableNameText = String(tableName)
  const pragmaResult = db.exec(`PRAGMA table_info(${quoteIdentifier(tableNameText)});`)
  const columnNames = getColumnNamesFromPragma(pragmaResult)
  const trTypeColumnName = columnNames.find((columnName) => columnName.toLowerCase() === 'trtype')
  const trEventColumnName = columnNames.find((columnName) => columnName.toLowerCase() === 'trevent')
  const trSourceColumnName = columnNames.find((columnName) => columnName.toLowerCase() === 'trsource')
  const trDateColumnName = columnNames.find((columnName) => columnName.toLowerCase() === 'trdate')
  const trDescriptionColumnName = columnNames.find(
    (columnName) => columnName.toLowerCase() === 'trdescription',
  )
  const trDestinationColumnName = columnNames.find(
    (columnName) => columnName.toLowerCase() === 'trdestination',
  )
  const orderCandidates = getOrderCandidates(columnNames)
  const hasTypeFilter = Boolean(trTypeColumnName && trTypeFilter && trTypeFilter.trim().length > 0)
  const hasEventFilter = Boolean(trEventColumnName && trEventFilter && trEventFilter.trim().length > 0)
  const hasAccountFilter = Boolean(
    trSourceColumnName && accountFilter && accountFilter.trim().length > 0,
  )
  const hasCategoryFilter = Boolean(
    trDestinationColumnName && categoryFilter && categoryFilter.trim().length > 0,
  )
  const hasDescriptionFilter = Boolean(
    trDescriptionColumnName && descriptionFilter && descriptionFilter.trim().length > 0,
  )
  const hasFromDateFilter = Boolean(fromDateFilter && fromDateFilter.trim().length > 0)
  const hasToDateFilter = Boolean(toDateFilter && toDateFilter.trim().length > 0)
  const filters: string[] = []
  const trDateNormalizationExpression = trDateColumnName
    ? `date(CASE WHEN typeof(${quoteIdentifier(trDateColumnName)}) IN ('integer', 'real') THEN datetime(CASE WHEN CAST(${quoteIdentifier(trDateColumnName)} AS REAL) > 9999999999 THEN CAST(${quoteIdentifier(trDateColumnName)} AS REAL) / 1000 ELSE CAST(${quoteIdentifier(trDateColumnName)} AS REAL) END, 'unixepoch') ELSE datetime(CAST(${quoteIdentifier(trDateColumnName)} AS TEXT)) END)`
    : ''
  const trDateOrderExpression = trDateColumnName
    ? `(CASE WHEN typeof(${quoteIdentifier(trDateColumnName)}) IN ('integer', 'real') THEN CASE WHEN CAST(${quoteIdentifier(trDateColumnName)} AS REAL) > 9999999999 THEN CAST(${quoteIdentifier(trDateColumnName)} AS REAL) / 1000 ELSE CAST(${quoteIdentifier(trDateColumnName)} AS REAL) END ELSE CAST(strftime('%s', CAST(${quoteIdentifier(trDateColumnName)} AS TEXT)) AS REAL) END)`
    : ''
  const trValueOrderExpression = trValueExpression(columnNames)

  if (hasTypeFilter) {
    filters.push(`${quoteIdentifier(trTypeColumnName!)} = ${quoteSqlString(trTypeFilter!.trim())}`)
  }

  if (hasEventFilter) {
    filters.push(`${quoteIdentifier(trEventColumnName!)} = ${quoteSqlString(trEventFilter!.trim())}`)
  }

  if (hasAccountFilter) {
    filters.push(`${quoteIdentifier(trSourceColumnName!)} = ${quoteSqlString(accountFilter!.trim())}`)
  }

  if (hasCategoryFilter) {
    filters.push(
      `${quoteIdentifier(trDestinationColumnName!)} = ${quoteSqlString(categoryFilter!.trim())}`,
    )
  }

  if (hasDescriptionFilter) {
    filters.push(
      `instr(lower(CAST(${quoteIdentifier(trDescriptionColumnName!)} AS TEXT)), lower(${quoteSqlString(descriptionFilter!.trim())})) > 0`,
    )
  }

  if (trDateColumnName && hasFromDateFilter) {
    filters.push(`${trDateNormalizationExpression} >= date(${quoteSqlString(fromDateFilter!.trim())})`)
  }

  if (trDateColumnName && hasFromDateFilter && hasToDateFilter) {
    filters.push(`${trDateNormalizationExpression} <= date(${quoteSqlString(toDateFilter!.trim())})`)
  }

  const filterSql = filters.length > 0 ? ` WHERE ${filters.join(' AND ')}` : ''
  const totalRowsResult = db.exec(
    `SELECT COUNT(*) AS totalRows FROM ${quoteIdentifier(tableNameText)}${filterSql};`,
  )
  const totalRows = Number(getSingleValue(totalRowsResult, '0')) || 0
  const trValueBaseNumericExpression = trValueBaseExpression(columnNames)
  const trValueRefNumericExpression = trValueRefExpression(columnNames)
  const sumsQueryResult = db.exec(
    `SELECT ${trValueBaseNumericExpression ? `COALESCE(SUM(${trValueBaseNumericExpression}), 0)` : '0'} AS sumTrValueBase, ${trValueRefNumericExpression ? `COALESCE(SUM(${trValueRefNumericExpression}), 0)` : '0'} AS sumTrValueRef FROM ${quoteIdentifier(tableNameText)}${filterSql};`,
  )
  const sumTrValueBase = Number(sumsQueryResult[0]?.values[0]?.[0] ?? 0) || 0
  const sumTrValueRef = Number(sumsQueryResult[0]?.values[0]?.[1] ?? 0) || 0
  const availableTrTypes = trTypeColumnName
    ? getDistinctValues(db, tableNameText, trTypeColumnName, 'trType')
    : []
  const availableTrEvents = trEventColumnName
    ? getDistinctValues(db, tableNameText, trEventColumnName, 'trEvent')
    : []
  const availableAccounts = loadAvailableAccountsFromSettings(db)
  const availableCategories = loadAvailableCategoriesFromSettings(db)
  const safeSortDirection = sortDirection === 'asc' ? 'ASC' : 'DESC'

  const preferredOrderClauses: Array<{ label: string; expression: string }> = []
  if (sortColumn === 'date' && trDateOrderExpression) {
    preferredOrderClauses.push({ label: 'date', expression: trDateOrderExpression })
  }
  if (sortColumn === 'value' && trValueOrderExpression) {
    preferredOrderClauses.push({ label: 'value', expression: trValueOrderExpression })
  }

  const fallbackOrderClauses = orderCandidates.map((orderByColumn) => ({
    label: orderByColumn,
    expression: orderByColumn === 'rowid' ? 'rowid' : quoteIdentifier(orderByColumn),
  }))
  const orderClauses = [...preferredOrderClauses, ...fallbackOrderClauses]
  const seenOrderExpressions = new Set<string>()

  for (const orderClause of orderClauses) {
    if (seenOrderExpressions.has(orderClause.expression)) {
      continue
    }
    seenOrderExpressions.add(orderClause.expression)

    try {
      const queryResult = db.exec(
        `SELECT * FROM ${quoteIdentifier(tableNameText)}${filterSql} ORDER BY ${orderClause.expression} ${safeSortDirection} LIMIT ${limit} OFFSET ${offset};`,
      )

      const firstResult = queryResult[0]

      return {
        columns: firstResult?.columns ?? [],
        rows: firstResult?.values.map((row) => row.map((value) => normalizeValue(value))) ?? [],
        orderedBy: orderClause.label,
        offset,
        limit,
        totalRows,
        sumTrValueBase,
        sumTrValueRef,
        availableTrTypes,
        availableTrEvents,
        availableAccounts,
        availableCategories,
      }
    } catch {
      // Try next fallback column if current ORDER BY is not valid for this schema.
    }
  }

  const fallbackResult = db.exec(
    `SELECT * FROM ${quoteIdentifier(tableNameText)}${filterSql} LIMIT ${limit} OFFSET ${offset};`,
  )
  const firstResult = fallbackResult[0]

  return {
    columns: firstResult?.columns ?? [],
    rows: firstResult?.values.map((row) => row.map((value) => normalizeValue(value))) ?? [],
    orderedBy: 'fara_ordonare',
    offset,
    limit,
    totalRows,
    sumTrValueBase,
    sumTrValueRef,
    availableTrTypes,
    availableTrEvents,
    availableAccounts,
    availableCategories,
  }
}

function numericColumnExpression(columnName: string): string {
  return `CAST(REPLACE(REPLACE(CAST(${quoteIdentifier(columnName)} AS TEXT), ' ', ''), ',', '.') AS REAL)`
}

function trValueExpression(columnNames: string[]): string {
  const trValueColumnName = columnNames.find((columnName) => columnName.toLowerCase() === 'trvalue')
  const trValueDestColumnName = columnNames.find((columnName) => columnName.toLowerCase() === 'trvalue_dest')

  const sourceColumn = trValueColumnName ?? trValueDestColumnName

  if (!sourceColumn) {
    return ''
  }

  return numericColumnExpression(sourceColumn)
}

function trValueBaseExpression(columnNames: string[]): string {
  const trValueBaseColumnName = columnNames.find(
    (columnName) => columnName.toLowerCase() === 'trvaluebase' || columnName.toLowerCase() === 'trvalue_base',
  )

  if (!trValueBaseColumnName) {
    return ''
  }

  return numericColumnExpression(trValueBaseColumnName)
}

function trValueRefExpression(columnNames: string[]): string {
  const trValueRefColumnName = columnNames.find(
    (columnName) => columnName.toLowerCase() === 'trvalueref' || columnName.toLowerCase() === 'trvalue_ref',
  )

  if (!trValueRefColumnName) {
    return ''
  }

  return numericColumnExpression(trValueRefColumnName)
}

export async function inspectLocalSqlite(
  file: File,
  options: InspectLocalSqliteOptions = {},
): Promise<LocalSqliteInfo> {
  const SQL = await getSqlJs()
  const fileBuffer = await file.arrayBuffer()
  const bytes = new Uint8Array(fileBuffer)
  const transactionsOffset = Math.max(0, options.transactionsOffset ?? 0)
  const transactionsLimit = Math.max(1, options.transactionsLimit ?? 10)
  const transactionsTypeFilter = options.transactionsTypeFilter?.trim()
  const transactionsEventFilter = options.transactionsEventFilter?.trim()
  const transactionsAccountFilter = options.transactionsAccountFilter?.trim()
  const transactionsCategoryFilter = options.transactionsCategoryFilter?.trim()
  const transactionsDescriptionFilter = options.transactionsDescriptionFilter?.trim()
  const transactionsFromDate = options.transactionsFromDate?.trim()
  const transactionsToDate = options.transactionsToDate?.trim()
  const transactionsSortColumn = options.transactionsSortColumn ?? 'date'
  const transactionsSortDirection = options.transactionsSortDirection ?? 'desc'

  if (!hasSqliteHeader(bytes)) {
    throw new Error('Fisierul selectat nu are antet SQLite valid.')
  }

  const db = new SQL.Database(bytes)

  try {
    const versionResult = db.exec('SELECT sqlite_version() AS version;')
    const tableResult = db.exec(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name;",
    )

    const tableNames = tableResult[0]?.values.map((row) => String(row[0])) ?? []
    const latestTransactions = loadLatestTransactions(
      db,
      transactionsOffset,
      transactionsLimit,
      transactionsTypeFilter,
      transactionsEventFilter,
      transactionsAccountFilter,
      transactionsCategoryFilter,
      transactionsDescriptionFilter,
      transactionsFromDate,
      transactionsToDate,
      transactionsSortColumn,
      transactionsSortDirection,
    )

    return {
      sqliteVersion: getSingleValue(versionResult, 'necunoscuta'),
      tableNames,
      latestTransactions,
    }
  } finally {
    db.close()
  }
}

