import { type ChangeEvent, useEffect, useRef, useState } from 'react'
import { inspectLocalSqlite } from './sqlite/localSqlite'

type MenuItem = 'dashboard' | 'comenzi' | 'tranzactii' | 'setari'
type SortColumn = 'date' | 'value'
type SortDirection = 'asc' | 'desc'
const DEFAULT_TRANSACTIONS_PAGE_SIZE = 100
const DATE_ONLY_FORMATTER = new Intl.DateTimeFormat('ro-RO')
const VALUE_SUM_FORMATTER = new Intl.NumberFormat('ro-RO', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

function parseDateValue(rawValue: string): Date | null {
  const numericValue = Number(rawValue)

  if (!Number.isNaN(numericValue)) {
    // Supports unix timestamps in seconds (10 digits) and milliseconds (13 digits).
    const parsedFromNumber = new Date(numericValue < 1_000_000_000_000 ? numericValue * 1000 : numericValue)
    if (!Number.isNaN(parsedFromNumber.getTime())) {
      return parsedFromNumber
    }
  }

  const parsedFromText = new Date(rawValue)
  if (!Number.isNaN(parsedFromText.getTime())) {
    return parsedFromText
  }

  return null
}

function formatTrDateValue(rawValue: string): string {
  const parsedDate = parseDateValue(rawValue)
  return parsedDate ? DATE_ONLY_FORMATTER.format(parsedDate) : rawValue
}

function getColumnIndex(columns: string[], target: string): number {
  return columns.findIndex((columnName) => columnName.toLowerCase() === target.toLowerCase())
}

function App() {
  const [activeMenu, setActiveMenu] = useState<MenuItem>('dashboard')
  const [isCommandsOpen, setIsCommandsOpen] = useState(false)
  const [isDbLoading, setIsDbLoading] = useState(false)
  const [dbFileName, setDbFileName] = useState('')
  const [dbInfoMessage, setDbInfoMessage] = useState('Nicio baza SQLite incarcata.')
  const [dbTables, setDbTables] = useState<string[]>([])
  const [selectedDbFile, setSelectedDbFile] = useState<File | null>(null)
  const [transactionsColumns, setTransactionsColumns] = useState<string[]>([])
  const [transactionsRows, setTransactionsRows] = useState<string[][]>([])
  const [transactionsOrderedBy, setTransactionsOrderedBy] = useState('')
  const [availableTrTypes, setAvailableTrTypes] = useState<string[]>([])
  const [availableTrEvents, setAvailableTrEvents] = useState<string[]>([])
  const [availableAccounts, setAvailableAccounts] = useState<string[]>([])
  const [availableCategories, setAvailableCategories] = useState<string[]>([])
  const [selectedTrType, setSelectedTrType] = useState('all')
  const [selectedTrEvent, setSelectedTrEvent] = useState('all')
  const [selectedAccount, setSelectedAccount] = useState('all')
  const [selectedCategory, setSelectedCategory] = useState('all')
  const [transactionsPageSizeInput, setTransactionsPageSizeInput] = useState(String(DEFAULT_TRANSACTIONS_PAGE_SIZE))
  const [transactionsPageSize, setTransactionsPageSize] = useState(DEFAULT_TRANSACTIONS_PAGE_SIZE)
  const [descriptionFilterInput, setDescriptionFilterInput] = useState('')
  const [appliedDescriptionFilter, setAppliedDescriptionFilter] = useState('')
  const [fromDateInput, setFromDateInput] = useState('')
  const [toDateInput, setToDateInput] = useState('')
  const [appliedFromDate, setAppliedFromDate] = useState('')
  const [appliedToDate, setAppliedToDate] = useState('')
  const [sumTrValueBase, setSumTrValueBase] = useState(0)
  const [sumTrValueRef, setSumTrValueRef] = useState(0)
  const [sortColumn, setSortColumn] = useState<SortColumn>('date')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')
  const [transactionsOffset, setTransactionsOffset] = useState(0)
  const [transactionsTotalRows, setTransactionsTotalRows] = useState(0)
  const [isTransactionsLoading, setIsTransactionsLoading] = useState(false)
  const [dbError, setDbError] = useState('')
  const menuContainerRef = useRef<HTMLDivElement | null>(null)
  const sqliteInputRef = useRef<HTMLInputElement | null>(null)
  const hasTransactionsTable = dbTables.some((tableName) => tableName.toLowerCase() === 'transactions')
  const trDateIndex = getColumnIndex(transactionsColumns, 'trDate')
  const trTypeIndex = getColumnIndex(transactionsColumns, 'trType')
  const trDestinationIndex = getColumnIndex(transactionsColumns, 'trDestination')
  const trDescriptionIndex = getColumnIndex(transactionsColumns, 'trDescription')
  const trValueIndex = getColumnIndex(transactionsColumns, 'trValue')
  const trCurrencyDestIndex = getColumnIndex(transactionsColumns, 'trCurrency_Dest')
  const transactionDisplayRows = transactionsRows.map((row) => {
    const dateValue = trDateIndex >= 0 ? formatTrDateValue(row[trDateIndex] ?? '') : ''
    const typeValue = trTypeIndex >= 0 ? row[trTypeIndex] ?? '' : ''
    const forValue = trDestinationIndex >= 0 ? row[trDestinationIndex] ?? '' : ''
    const descriptionValue = trDescriptionIndex >= 0 ? row[trDescriptionIndex] ?? '' : ''
    const valuePart = trValueIndex >= 0 ? row[trValueIndex] ?? '' : ''
    const currencyPart = trCurrencyDestIndex >= 0 ? row[trCurrencyDestIndex] ?? '' : ''
    const combinedValue = [valuePart, currencyPart].filter(Boolean).join(' ')

    return {
      date: dateValue,
      type: typeValue,
      for: forValue,
      description: descriptionValue,
      value: combinedValue,
    }
  })
  const transactionsStart = transactionsTotalRows === 0 ? 0 : transactionsOffset + 1
  const transactionsEnd = transactionsOffset + transactionsRows.length
  const canGoPrev = transactionsOffset > 0
  const canGoNext = transactionsEnd < transactionsTotalRows
  const activeTrTypeFilter = selectedTrType === 'all' ? undefined : selectedTrType
  const activeTrEventFilter = selectedTrEvent === 'all' ? undefined : selectedTrEvent
  const activeAccountFilter = selectedAccount === 'all' ? undefined : selectedAccount
  const activeCategoryFilter = selectedCategory === 'all' ? undefined : selectedCategory
  const activeDescriptionFilter = appliedDescriptionFilter.trim().length > 0 ? appliedDescriptionFilter : undefined
  const activeFromDateFilter = appliedFromDate.trim().length > 0 ? appliedFromDate : undefined
  const activeToDateFilter =
    appliedFromDate.trim().length > 0 && appliedToDate.trim().length > 0 ? appliedToDate : undefined

  useEffect(() => {
    if (!isCommandsOpen) {
      return
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!menuContainerRef.current) {
        return
      }

      if (!menuContainerRef.current.contains(event.target as Node)) {
        setIsCommandsOpen(false)
      }
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsCommandsOpen(false)
      }
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleEscape)

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [isCommandsOpen])

  useEffect(() => {
    if (selectedAccount === 'all') {
      return
    }

    if (!availableAccounts.includes(selectedAccount)) {
      setSelectedAccount('all')
    }
  }, [availableAccounts, selectedAccount])

  useEffect(() => {
    if (selectedCategory === 'all') {
      return
    }

    if (!availableCategories.includes(selectedCategory)) {
      setSelectedCategory('all')
    }
  }, [availableCategories, selectedCategory])

  const handleSqliteFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0]

    if (!selectedFile) {
      return
    }

    setIsDbLoading(true)
    setDbError('')
    setDbTables([])
    setSelectedDbFile(selectedFile)
    setTransactionsColumns([])
    setTransactionsRows([])
    setTransactionsOrderedBy('')
    setAvailableTrTypes([])
    setAvailableTrEvents([])
    setAvailableAccounts([])
    setAvailableCategories([])
    setSelectedTrType('all')
    setSelectedTrEvent('all')
    setSelectedAccount('all')
    setSelectedCategory('all')
    setDescriptionFilterInput('')
    setAppliedDescriptionFilter('')
    setFromDateInput('')
    setToDateInput('')
    setAppliedFromDate('')
    setAppliedToDate('')
    setSumTrValueBase(0)
    setSumTrValueRef(0)
    setTransactionsOffset(0)
    setTransactionsTotalRows(0)
    setDbFileName(selectedFile.name)

    try {
      const dbInfo = await inspectLocalSqlite(selectedFile, {
        transactionsOffset: 0,
        transactionsLimit: transactionsPageSize,
        transactionsTypeFilter: undefined,
        transactionsEventFilter: undefined,
        transactionsAccountFilter: undefined,
        transactionsCategoryFilter: undefined,
        transactionsDescriptionFilter: undefined,
        transactionsFromDate: undefined,
        transactionsToDate: undefined,
        transactionsSortColumn: sortColumn,
        transactionsSortDirection: sortDirection,
      })

      setDbInfoMessage(`Baza deschisa cu succes. SQLite versiune: ${dbInfo.sqliteVersion}`)
      setDbTables(dbInfo.tableNames)
      setTransactionsColumns(dbInfo.latestTransactions?.columns ?? [])
      setTransactionsRows(dbInfo.latestTransactions?.rows ?? [])
      setTransactionsOrderedBy(dbInfo.latestTransactions?.orderedBy ?? '')
      setAvailableTrTypes(dbInfo.latestTransactions?.availableTrTypes ?? [])
      setAvailableTrEvents(dbInfo.latestTransactions?.availableTrEvents ?? [])
      setAvailableAccounts(dbInfo.latestTransactions?.availableAccounts ?? [])
      setAvailableCategories(dbInfo.latestTransactions?.availableCategories ?? [])
      setTransactionsOffset(dbInfo.latestTransactions?.offset ?? 0)
      setTransactionsTotalRows(dbInfo.latestTransactions?.totalRows ?? 0)
      setSumTrValueBase(dbInfo.latestTransactions?.sumTrValueBase ?? 0)
      setSumTrValueRef(dbInfo.latestTransactions?.sumTrValueRef ?? 0)
    } catch {
      setDbInfoMessage('Nu s-a putut citi baza selectata.')
      setDbError('Verifica daca fisierul este o baza SQLite valida (.db, .sqlite, .sqlite3).')
      setSelectedDbFile(null)
      setSumTrValueBase(0)
      setSumTrValueRef(0)
      setTransactionsOffset(0)
      setTransactionsTotalRows(0)
    } finally {
      setIsDbLoading(false)
      event.target.value = ''
    }
  }

  const handleTransactionsPageChange = async (nextOffset: number) => {
    if (!selectedDbFile || !hasTransactionsTable) {
      return
    }

    setIsTransactionsLoading(true)
    setDbError('')

    try {
      const dbInfo = await inspectLocalSqlite(selectedDbFile, {
        transactionsOffset: nextOffset,
        transactionsLimit: transactionsPageSize,
        transactionsTypeFilter: activeTrTypeFilter,
        transactionsEventFilter: activeTrEventFilter,
        transactionsAccountFilter: activeAccountFilter,
        transactionsCategoryFilter: activeCategoryFilter,
        transactionsDescriptionFilter: activeDescriptionFilter,
        transactionsFromDate: activeFromDateFilter,
        transactionsToDate: activeToDateFilter,
        transactionsSortColumn: sortColumn,
        transactionsSortDirection: sortDirection,
      })

      setDbTables(dbInfo.tableNames)
      setTransactionsColumns(dbInfo.latestTransactions?.columns ?? [])
      setTransactionsRows(dbInfo.latestTransactions?.rows ?? [])
      setTransactionsOrderedBy(dbInfo.latestTransactions?.orderedBy ?? '')
      setAvailableTrTypes(dbInfo.latestTransactions?.availableTrTypes ?? [])
      setAvailableTrEvents(dbInfo.latestTransactions?.availableTrEvents ?? [])
      setAvailableAccounts(dbInfo.latestTransactions?.availableAccounts ?? [])
      setAvailableCategories(dbInfo.latestTransactions?.availableCategories ?? [])
      setTransactionsOffset(dbInfo.latestTransactions?.offset ?? 0)
      setTransactionsTotalRows(dbInfo.latestTransactions?.totalRows ?? 0)
      setSumTrValueBase(dbInfo.latestTransactions?.sumTrValueBase ?? 0)
      setSumTrValueRef(dbInfo.latestTransactions?.sumTrValueRef ?? 0)
    } catch {
      setDbError('Nu s-a putut incarca pagina de tranzactii.')
    } finally {
      setIsTransactionsLoading(false)
    }
  }

  const handleTrTypeFilterChange = async (event: ChangeEvent<HTMLSelectElement>) => {
    const nextSelectedType = event.target.value

    setSelectedTrType(nextSelectedType)

    if (!selectedDbFile || !hasTransactionsTable) {
      return
    }

    setIsTransactionsLoading(true)
    setDbError('')

    try {
      const dbInfo = await inspectLocalSqlite(selectedDbFile, {
        transactionsOffset: 0,
        transactionsLimit: transactionsPageSize,
        transactionsTypeFilter: nextSelectedType === 'all' ? undefined : nextSelectedType,
        transactionsEventFilter: activeTrEventFilter,
        transactionsAccountFilter: activeAccountFilter,
        transactionsCategoryFilter: activeCategoryFilter,
        transactionsDescriptionFilter: activeDescriptionFilter,
        transactionsFromDate: activeFromDateFilter,
        transactionsToDate: activeToDateFilter,
        transactionsSortColumn: sortColumn,
        transactionsSortDirection: sortDirection,
      })

      setDbTables(dbInfo.tableNames)
      setTransactionsColumns(dbInfo.latestTransactions?.columns ?? [])
      setTransactionsRows(dbInfo.latestTransactions?.rows ?? [])
      setTransactionsOrderedBy(dbInfo.latestTransactions?.orderedBy ?? '')
      setAvailableTrTypes(dbInfo.latestTransactions?.availableTrTypes ?? [])
      setAvailableTrEvents(dbInfo.latestTransactions?.availableTrEvents ?? [])
      setAvailableAccounts(dbInfo.latestTransactions?.availableAccounts ?? [])
      setAvailableCategories(dbInfo.latestTransactions?.availableCategories ?? [])
      setTransactionsOffset(dbInfo.latestTransactions?.offset ?? 0)
      setTransactionsTotalRows(dbInfo.latestTransactions?.totalRows ?? 0)
      setSumTrValueBase(dbInfo.latestTransactions?.sumTrValueBase ?? 0)
      setSumTrValueRef(dbInfo.latestTransactions?.sumTrValueRef ?? 0)
    } catch {
      setDbError('Nu s-a putut aplica filtrul pe trType.')
    } finally {
      setIsTransactionsLoading(false)
    }
  }

  const handleTrEventFilterChange = async (event: ChangeEvent<HTMLSelectElement>) => {
    const nextSelectedEvent = event.target.value

    setSelectedTrEvent(nextSelectedEvent)

    if (!selectedDbFile || !hasTransactionsTable) {
      return
    }

    setIsTransactionsLoading(true)
    setDbError('')

    try {
      const dbInfo = await inspectLocalSqlite(selectedDbFile, {
        transactionsOffset: 0,
        transactionsLimit: transactionsPageSize,
        transactionsTypeFilter: activeTrTypeFilter,
        transactionsEventFilter: nextSelectedEvent === 'all' ? undefined : nextSelectedEvent,
        transactionsAccountFilter: activeAccountFilter,
        transactionsCategoryFilter: activeCategoryFilter,
        transactionsDescriptionFilter: activeDescriptionFilter,
        transactionsFromDate: activeFromDateFilter,
        transactionsToDate: activeToDateFilter,
        transactionsSortColumn: sortColumn,
        transactionsSortDirection: sortDirection,
      })

      setDbTables(dbInfo.tableNames)
      setTransactionsColumns(dbInfo.latestTransactions?.columns ?? [])
      setTransactionsRows(dbInfo.latestTransactions?.rows ?? [])
      setTransactionsOrderedBy(dbInfo.latestTransactions?.orderedBy ?? '')
      setAvailableTrTypes(dbInfo.latestTransactions?.availableTrTypes ?? [])
      setAvailableTrEvents(dbInfo.latestTransactions?.availableTrEvents ?? [])
      setAvailableAccounts(dbInfo.latestTransactions?.availableAccounts ?? [])
      setAvailableCategories(dbInfo.latestTransactions?.availableCategories ?? [])
      setTransactionsOffset(dbInfo.latestTransactions?.offset ?? 0)
      setTransactionsTotalRows(dbInfo.latestTransactions?.totalRows ?? 0)
      setSumTrValueBase(dbInfo.latestTransactions?.sumTrValueBase ?? 0)
      setSumTrValueRef(dbInfo.latestTransactions?.sumTrValueRef ?? 0)
    } catch {
      setDbError('Nu s-a putut aplica filtrul pe trEvent.')
    } finally {
      setIsTransactionsLoading(false)
    }
  }

  const handleAccountFilterChange = async (event: ChangeEvent<HTMLSelectElement>) => {
    const nextSelectedAccount = event.target.value

    setSelectedAccount(nextSelectedAccount)

    if (!selectedDbFile || !hasTransactionsTable) {
      return
    }

    setIsTransactionsLoading(true)
    setDbError('')

    try {
      const dbInfo = await inspectLocalSqlite(selectedDbFile, {
        transactionsOffset: 0,
        transactionsLimit: transactionsPageSize,
        transactionsTypeFilter: activeTrTypeFilter,
        transactionsEventFilter: activeTrEventFilter,
        transactionsAccountFilter: nextSelectedAccount === 'all' ? undefined : nextSelectedAccount,
        transactionsCategoryFilter: activeCategoryFilter,
        transactionsDescriptionFilter: activeDescriptionFilter,
        transactionsFromDate: activeFromDateFilter,
        transactionsToDate: activeToDateFilter,
        transactionsSortColumn: sortColumn,
        transactionsSortDirection: sortDirection,
      })

      setDbTables(dbInfo.tableNames)
      setTransactionsColumns(dbInfo.latestTransactions?.columns ?? [])
      setTransactionsRows(dbInfo.latestTransactions?.rows ?? [])
      setTransactionsOrderedBy(dbInfo.latestTransactions?.orderedBy ?? '')
      setAvailableTrTypes(dbInfo.latestTransactions?.availableTrTypes ?? [])
      setAvailableTrEvents(dbInfo.latestTransactions?.availableTrEvents ?? [])
      setAvailableAccounts(dbInfo.latestTransactions?.availableAccounts ?? [])
      setAvailableCategories(dbInfo.latestTransactions?.availableCategories ?? [])
      setTransactionsOffset(dbInfo.latestTransactions?.offset ?? 0)
      setTransactionsTotalRows(dbInfo.latestTransactions?.totalRows ?? 0)
      setSumTrValueBase(dbInfo.latestTransactions?.sumTrValueBase ?? 0)
      setSumTrValueRef(dbInfo.latestTransactions?.sumTrValueRef ?? 0)
    } catch {
      setDbError('Nu s-a putut aplica filtrul pe Accounts.')
    } finally {
      setIsTransactionsLoading(false)
    }
  }

  const handleCategoryFilterChange = async (event: ChangeEvent<HTMLSelectElement>) => {
    const nextSelectedCategory = event.target.value

    setSelectedCategory(nextSelectedCategory)

    if (!selectedDbFile || !hasTransactionsTable) {
      return
    }

    setIsTransactionsLoading(true)
    setDbError('')

    try {
      const dbInfo = await inspectLocalSqlite(selectedDbFile, {
        transactionsOffset: 0,
        transactionsLimit: transactionsPageSize,
        transactionsTypeFilter: activeTrTypeFilter,
        transactionsEventFilter: activeTrEventFilter,
        transactionsAccountFilter: activeAccountFilter,
        transactionsCategoryFilter: nextSelectedCategory === 'all' ? undefined : nextSelectedCategory,
        transactionsDescriptionFilter: activeDescriptionFilter,
        transactionsFromDate: activeFromDateFilter,
        transactionsToDate: activeToDateFilter,
        transactionsSortColumn: sortColumn,
        transactionsSortDirection: sortDirection,
      })

      setDbTables(dbInfo.tableNames)
      setTransactionsColumns(dbInfo.latestTransactions?.columns ?? [])
      setTransactionsRows(dbInfo.latestTransactions?.rows ?? [])
      setTransactionsOrderedBy(dbInfo.latestTransactions?.orderedBy ?? '')
      setAvailableTrTypes(dbInfo.latestTransactions?.availableTrTypes ?? [])
      setAvailableTrEvents(dbInfo.latestTransactions?.availableTrEvents ?? [])
      setAvailableAccounts(dbInfo.latestTransactions?.availableAccounts ?? [])
      setAvailableCategories(dbInfo.latestTransactions?.availableCategories ?? [])
      setTransactionsOffset(dbInfo.latestTransactions?.offset ?? 0)
      setTransactionsTotalRows(dbInfo.latestTransactions?.totalRows ?? 0)
      setSumTrValueBase(dbInfo.latestTransactions?.sumTrValueBase ?? 0)
      setSumTrValueRef(dbInfo.latestTransactions?.sumTrValueRef ?? 0)
    } catch {
      setDbError('Nu s-a putut aplica filtrul pe Categories.')
    } finally {
      setIsTransactionsLoading(false)
    }
  }

  const applyDescriptionFilter = async () => {
    if (!selectedDbFile || !hasTransactionsTable) {
      return
    }

    const nextFilter = descriptionFilterInput.trim()
    setAppliedDescriptionFilter(nextFilter)
    setIsTransactionsLoading(true)
    setDbError('')

    try {
      const dbInfo = await inspectLocalSqlite(selectedDbFile, {
        transactionsOffset: 0,
        transactionsLimit: transactionsPageSize,
        transactionsTypeFilter: activeTrTypeFilter,
        transactionsEventFilter: activeTrEventFilter,
        transactionsAccountFilter: activeAccountFilter,
        transactionsCategoryFilter: activeCategoryFilter,
        transactionsDescriptionFilter: nextFilter.length > 0 ? nextFilter : undefined,
        transactionsFromDate: activeFromDateFilter,
        transactionsToDate: activeToDateFilter,
        transactionsSortColumn: sortColumn,
        transactionsSortDirection: sortDirection,
      })

      setDbTables(dbInfo.tableNames)
      setTransactionsColumns(dbInfo.latestTransactions?.columns ?? [])
      setTransactionsRows(dbInfo.latestTransactions?.rows ?? [])
      setTransactionsOrderedBy(dbInfo.latestTransactions?.orderedBy ?? '')
      setAvailableTrTypes(dbInfo.latestTransactions?.availableTrTypes ?? [])
      setAvailableTrEvents(dbInfo.latestTransactions?.availableTrEvents ?? [])
      setAvailableAccounts(dbInfo.latestTransactions?.availableAccounts ?? [])
      setAvailableCategories(dbInfo.latestTransactions?.availableCategories ?? [])
      setTransactionsOffset(dbInfo.latestTransactions?.offset ?? 0)
      setTransactionsTotalRows(dbInfo.latestTransactions?.totalRows ?? 0)
      setSumTrValueBase(dbInfo.latestTransactions?.sumTrValueBase ?? 0)
      setSumTrValueRef(dbInfo.latestTransactions?.sumTrValueRef ?? 0)
    } catch {
      setDbError('Nu s-a putut aplica filtrul text pe trDescription.')
    } finally {
      setIsTransactionsLoading(false)
    }
  }

  const clearDescriptionFilter = async () => {
    setDescriptionFilterInput('')
    setAppliedDescriptionFilter('')

    if (!selectedDbFile || !hasTransactionsTable) {
      return
    }

    setIsTransactionsLoading(true)
    setDbError('')

    try {
      const dbInfo = await inspectLocalSqlite(selectedDbFile, {
        transactionsOffset: 0,
        transactionsLimit: transactionsPageSize,
        transactionsTypeFilter: activeTrTypeFilter,
        transactionsEventFilter: activeTrEventFilter,
        transactionsAccountFilter: activeAccountFilter,
        transactionsCategoryFilter: activeCategoryFilter,
        transactionsDescriptionFilter: undefined,
        transactionsFromDate: activeFromDateFilter,
        transactionsToDate: activeToDateFilter,
        transactionsSortColumn: sortColumn,
        transactionsSortDirection: sortDirection,
      })

      setDbTables(dbInfo.tableNames)
      setTransactionsColumns(dbInfo.latestTransactions?.columns ?? [])
      setTransactionsRows(dbInfo.latestTransactions?.rows ?? [])
      setTransactionsOrderedBy(dbInfo.latestTransactions?.orderedBy ?? '')
      setAvailableTrTypes(dbInfo.latestTransactions?.availableTrTypes ?? [])
      setAvailableTrEvents(dbInfo.latestTransactions?.availableTrEvents ?? [])
      setAvailableAccounts(dbInfo.latestTransactions?.availableAccounts ?? [])
      setAvailableCategories(dbInfo.latestTransactions?.availableCategories ?? [])
      setTransactionsOffset(dbInfo.latestTransactions?.offset ?? 0)
      setTransactionsTotalRows(dbInfo.latestTransactions?.totalRows ?? 0)
      setSumTrValueBase(dbInfo.latestTransactions?.sumTrValueBase ?? 0)
      setSumTrValueRef(dbInfo.latestTransactions?.sumTrValueRef ?? 0)
    } catch {
      setDbError('Nu s-a putut reseta filtrul text pe trDescription.')
    } finally {
      setIsTransactionsLoading(false)
    }
  }

  const applyDateRangeFilter = async () => {
    if (!selectedDbFile || !hasTransactionsTable) {
      return
    }

    const nextFromDate = fromDateInput.trim()
    const nextToDate = toDateInput.trim()

    if (!nextFromDate) {
      setDbError('Selecteaza cel putin data From pentru filtrul de data.')
      return
    }

    if (nextToDate && nextFromDate > nextToDate) {
      setDbError('Data From trebuie sa fie mai mica sau egala cu data To.')
      return
    }

    setAppliedFromDate(nextFromDate)
    setAppliedToDate(nextToDate)
    setIsTransactionsLoading(true)
    setDbError('')

    try {
      const dbInfo = await inspectLocalSqlite(selectedDbFile, {
        transactionsOffset: 0,
        transactionsLimit: transactionsPageSize,
        transactionsTypeFilter: activeTrTypeFilter,
        transactionsEventFilter: activeTrEventFilter,
        transactionsAccountFilter: activeAccountFilter,
        transactionsCategoryFilter: activeCategoryFilter,
        transactionsDescriptionFilter: activeDescriptionFilter,
        transactionsFromDate: nextFromDate,
        transactionsToDate: nextToDate || undefined,
        transactionsSortColumn: sortColumn,
        transactionsSortDirection: sortDirection,
      })

      setDbTables(dbInfo.tableNames)
      setTransactionsColumns(dbInfo.latestTransactions?.columns ?? [])
      setTransactionsRows(dbInfo.latestTransactions?.rows ?? [])
      setTransactionsOrderedBy(dbInfo.latestTransactions?.orderedBy ?? '')
      setAvailableTrTypes(dbInfo.latestTransactions?.availableTrTypes ?? [])
      setAvailableTrEvents(dbInfo.latestTransactions?.availableTrEvents ?? [])
      setAvailableAccounts(dbInfo.latestTransactions?.availableAccounts ?? [])
      setAvailableCategories(dbInfo.latestTransactions?.availableCategories ?? [])
      setTransactionsOffset(dbInfo.latestTransactions?.offset ?? 0)
      setTransactionsTotalRows(dbInfo.latestTransactions?.totalRows ?? 0)
      setSumTrValueBase(dbInfo.latestTransactions?.sumTrValueBase ?? 0)
      setSumTrValueRef(dbInfo.latestTransactions?.sumTrValueRef ?? 0)
    } catch {
      setDbError('Nu s-a putut aplica filtrul de date.')
    } finally {
      setIsTransactionsLoading(false)
    }
  }

  const clearDateRangeFilter = async () => {
    setFromDateInput('')
    setToDateInput('')
    setAppliedFromDate('')
    setAppliedToDate('')

    if (!selectedDbFile || !hasTransactionsTable) {
      return
    }

    setIsTransactionsLoading(true)
    setDbError('')

    try {
      const dbInfo = await inspectLocalSqlite(selectedDbFile, {
        transactionsOffset: 0,
        transactionsLimit: transactionsPageSize,
        transactionsTypeFilter: activeTrTypeFilter,
        transactionsEventFilter: activeTrEventFilter,
        transactionsAccountFilter: activeAccountFilter,
        transactionsCategoryFilter: activeCategoryFilter,
        transactionsDescriptionFilter: activeDescriptionFilter,
        transactionsFromDate: undefined,
        transactionsToDate: undefined,
        transactionsSortColumn: sortColumn,
        transactionsSortDirection: sortDirection,
      })

      setDbTables(dbInfo.tableNames)
      setTransactionsColumns(dbInfo.latestTransactions?.columns ?? [])
      setTransactionsRows(dbInfo.latestTransactions?.rows ?? [])
      setTransactionsOrderedBy(dbInfo.latestTransactions?.orderedBy ?? '')
      setAvailableTrTypes(dbInfo.latestTransactions?.availableTrTypes ?? [])
      setAvailableTrEvents(dbInfo.latestTransactions?.availableTrEvents ?? [])
      setAvailableAccounts(dbInfo.latestTransactions?.availableAccounts ?? [])
      setAvailableCategories(dbInfo.latestTransactions?.availableCategories ?? [])
      setTransactionsOffset(dbInfo.latestTransactions?.offset ?? 0)
      setTransactionsTotalRows(dbInfo.latestTransactions?.totalRows ?? 0)
      setSumTrValueBase(dbInfo.latestTransactions?.sumTrValueBase ?? 0)
      setSumTrValueRef(dbInfo.latestTransactions?.sumTrValueRef ?? 0)
    } catch {
      setDbError('Nu s-a putut reseta filtrul de date.')
    } finally {
      setIsTransactionsLoading(false)
    }
  }

  const handleSortClick = (column: SortColumn) => {
    const nextSortColumn = column
    const nextSortDirection: SortDirection =
      sortColumn === column ? (sortDirection === 'asc' ? 'desc' : 'asc') : 'desc'

    setSortColumn(nextSortColumn)
    setSortDirection(nextSortDirection)

    if (!selectedDbFile || !hasTransactionsTable) {
      return
    }

    void (async () => {
      setIsTransactionsLoading(true)
      setDbError('')

      try {
        const dbInfo = await inspectLocalSqlite(selectedDbFile, {
          transactionsOffset: 0,
          transactionsLimit: transactionsPageSize,
          transactionsTypeFilter: activeTrTypeFilter,
          transactionsEventFilter: activeTrEventFilter,
          transactionsAccountFilter: activeAccountFilter,
          transactionsCategoryFilter: activeCategoryFilter,
          transactionsDescriptionFilter: activeDescriptionFilter,
          transactionsFromDate: activeFromDateFilter,
          transactionsToDate: activeToDateFilter,
          transactionsSortColumn: nextSortColumn,
          transactionsSortDirection: nextSortDirection,
        })

        setDbTables(dbInfo.tableNames)
        setTransactionsColumns(dbInfo.latestTransactions?.columns ?? [])
        setTransactionsRows(dbInfo.latestTransactions?.rows ?? [])
        setTransactionsOrderedBy(dbInfo.latestTransactions?.orderedBy ?? '')
        setAvailableTrTypes(dbInfo.latestTransactions?.availableTrTypes ?? [])
        setAvailableTrEvents(dbInfo.latestTransactions?.availableTrEvents ?? [])
        setAvailableAccounts(dbInfo.latestTransactions?.availableAccounts ?? [])
        setAvailableCategories(dbInfo.latestTransactions?.availableCategories ?? [])
        setTransactionsOffset(dbInfo.latestTransactions?.offset ?? 0)
        setTransactionsTotalRows(dbInfo.latestTransactions?.totalRows ?? 0)
        setSumTrValueBase(dbInfo.latestTransactions?.sumTrValueBase ?? 0)
        setSumTrValueRef(dbInfo.latestTransactions?.sumTrValueRef ?? 0)
      } catch {
        setDbError('Nu s-a putut aplica sortarea SQL.')
      } finally {
        setIsTransactionsLoading(false)
      }
    })()
  }

  const applyTransactionsPageSize = async () => {
    const parsedValue = Number.parseInt(transactionsPageSizeInput, 10)

    if (!Number.isInteger(parsedValue) || parsedValue <= 0) {
      setDbError('Numarul de tranzactii pe pagina trebuie sa fie un numar intreg mai mare ca 0.')
      return
    }

    if (parsedValue > 500) {
      setDbError('Numarul de tranzactii pe pagina este prea mare. Foloseste maxim 500.')
      return
    }

    setTransactionsPageSize(parsedValue)

    if (!selectedDbFile || !hasTransactionsTable) {
      return
    }

    setIsTransactionsLoading(true)
    setDbError('')

    try {
      const dbInfo = await inspectLocalSqlite(selectedDbFile, {
        transactionsOffset: 0,
        transactionsLimit: parsedValue,
        transactionsTypeFilter: activeTrTypeFilter,
        transactionsEventFilter: activeTrEventFilter,
        transactionsAccountFilter: activeAccountFilter,
        transactionsCategoryFilter: activeCategoryFilter,
        transactionsDescriptionFilter: activeDescriptionFilter,
        transactionsFromDate: activeFromDateFilter,
        transactionsToDate: activeToDateFilter,
        transactionsSortColumn: sortColumn,
        transactionsSortDirection: sortDirection,
      })

      setDbTables(dbInfo.tableNames)
      setTransactionsColumns(dbInfo.latestTransactions?.columns ?? [])
      setTransactionsRows(dbInfo.latestTransactions?.rows ?? [])
      setTransactionsOrderedBy(dbInfo.latestTransactions?.orderedBy ?? '')
      setAvailableTrTypes(dbInfo.latestTransactions?.availableTrTypes ?? [])
      setAvailableTrEvents(dbInfo.latestTransactions?.availableTrEvents ?? [])
      setAvailableAccounts(dbInfo.latestTransactions?.availableAccounts ?? [])
      setAvailableCategories(dbInfo.latestTransactions?.availableCategories ?? [])
      setTransactionsOffset(dbInfo.latestTransactions?.offset ?? 0)
      setTransactionsTotalRows(dbInfo.latestTransactions?.totalRows ?? 0)
      setSumTrValueBase(dbInfo.latestTransactions?.sumTrValueBase ?? 0)
      setSumTrValueRef(dbInfo.latestTransactions?.sumTrValueRef ?? 0)
    } catch {
      setDbError('Nu s-a putut aplica numarul de tranzactii pe pagina.')
    } finally {
      setIsTransactionsLoading(false)
    }
  }

  return (
    <div style={{ padding: '20px', fontFamily: 'Arial, sans-serif' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ margin: 0 }}>Finance PWA</h1>

        <div ref={menuContainerRef} style={{ position: 'relative' }}>
          <button
            onClick={() => setIsCommandsOpen((prev) => !prev)}
            aria-label='Deschide meniul de comenzi'
            style={{
              width: '40px',
              height: '40px',
              borderRadius: '8px',
              border: '1px solid #ccc',
              background: '#fff',
              cursor: 'pointer',
              fontSize: '22px',
              lineHeight: 1,
            }}
          >
            ⋮
          </button>

          {isCommandsOpen && (
            <div
              style={{
                position: 'absolute',
                top: '46px',
                right: 0,
                minWidth: '200px',
                background: '#fff',
                border: '1px solid #ddd',
                borderRadius: '8px',
                boxShadow: '0 6px 16px rgba(0, 0, 0, 0.12)',
                padding: '6px',
                display: 'grid',
                gap: '4px',
                zIndex: 10,
              }}
            >
              <button
                onClick={() => {
                  setActiveMenu('dashboard')
                  setIsCommandsOpen(false)
                }}
                style={{
                  textAlign: 'left',
                  padding: '8px 10px',
                  border: 'none',
                  borderRadius: '6px',
                  background: activeMenu === 'dashboard' ? '#e8f0ff' : 'transparent',
                  cursor: 'pointer',
                }}
              >
                Dashboard
              </button>

              <button
                onClick={() => {
                  setActiveMenu('comenzi')
                  setIsCommandsOpen(false)
                }}
                style={{
                  textAlign: 'left',
                  padding: '8px 10px',
                  border: 'none',
                  borderRadius: '6px',
                  background: activeMenu === 'comenzi' ? '#e8f0ff' : 'transparent',
                  cursor: 'pointer',
                }}
              >
                Comenzi
              </button>

              <button
                onClick={() => {
                  setActiveMenu('tranzactii')
                  setIsCommandsOpen(false)
                }}
                style={{
                  textAlign: 'left',
                  padding: '8px 10px',
                  border: 'none',
                  borderRadius: '6px',
                  background: activeMenu === 'tranzactii' ? '#e8f0ff' : 'transparent',
                  cursor: 'pointer',
                }}
              >
                Tranzactii
              </button>

              <button
                onClick={() => {
                  setActiveMenu('setari')
                  setIsCommandsOpen(false)
                }}
                style={{
                  textAlign: 'left',
                  padding: '8px 10px',
                  border: 'none',
                  borderRadius: '6px',
                  background: activeMenu === 'setari' ? '#e8f0ff' : 'transparent',
                  cursor: 'pointer',
                }}
              >
                Setari
              </button>
            </div>
          )}
        </div>
      </div>

      <p style={{ color: '#666', marginTop: '12px' }}>
        Apasa pe meniul cu trei puncte pentru comenzi.
      </p>

      <section
        style={{
          padding: '16px',
          border: '1px solid #ddd',
          borderRadius: '8px',
          minHeight: '120px',
        }}
      >
        {activeMenu === 'dashboard' && <p>Overview rapid al aplicatiei.</p>}
        {activeMenu === 'comenzi' && (
          <div style={{ display: 'grid', gap: '12px' }}>
            <p style={{ margin: 0 }}>Comanda: incearca o baza de date SQLite din local.</p>

            <div>
              <input
                ref={sqliteInputRef}
                type='file'
                onChange={handleSqliteFileChange}
                style={{ display: 'none' }}
              />

              <button
                onClick={() => sqliteInputRef.current?.click()}
                disabled={isDbLoading}
                style={{
                  padding: '8px 12px',
                  borderRadius: '6px',
                  border: '1px solid #ccc',
                  background: isDbLoading ? '#f2f2f2' : '#fff',
                  cursor: isDbLoading ? 'not-allowed' : 'pointer',
                }}
              >
                {isDbLoading ? 'Incarcare...' : 'Incarca baza SQLite locala'}
              </button>
            </div>

            <p style={{ margin: 0, color: '#444' }}>{dbInfoMessage}</p>

            <p style={{ margin: 0, color: '#666' }}>
              Selectorul este permisiv ca sa mearga pe toate browserele; validarea SQLite se face dupa selectare.
            </p>

            {dbFileName && (
              <p style={{ margin: 0, color: '#666' }}>
                Fisier selectat: <strong>{dbFileName}</strong>
              </p>
            )}

            {dbError && (
              <p style={{ margin: 0, color: '#b00020' }}>
                {dbError}
              </p>
            )}

            {dbTables.length > 0 && (
              <div>
                <p style={{ margin: '0 0 8px 0' }}>Tabele detectate:</p>
                <ul style={{ margin: 0, paddingLeft: '18px' }}>
                  {dbTables.map((tableName) => (
                    <li key={tableName}>{tableName}</li>
                  ))}
                </ul>
              </div>
            )}

            {hasTransactionsTable && (
              <button
                onClick={() => setActiveMenu('tranzactii')}
                style={{
                  width: 'fit-content',
                  padding: '8px 12px',
                  borderRadius: '6px',
                  border: '1px solid #ccc',
                  background: '#fff',
                  cursor: 'pointer',
                }}
              >
                Vezi ultimele 10 tranzactii
              </button>
            )}
          </div>
        )}
        {activeMenu === 'tranzactii' && (
          <div style={{ display: 'grid', gap: '12px' }}>
            <p style={{ margin: 0 }}>Comanda: ultimele 10 tranzactii (ordonate desc dupa ultima adaugare).</p>

            {!dbFileName && (
              <p style={{ margin: 0, color: '#666' }}>
                Incarca mai intai o baza SQLite din meniul Comenzi.
              </p>
            )}

            {dbFileName && (
              <p style={{ margin: 0, color: '#666' }}>
                Baza curenta: <strong>{dbFileName}</strong>
              </p>
            )}

            {dbFileName && !hasTransactionsTable && (
              <p style={{ margin: 0, color: '#b00020' }}>
                Tabelul <strong>transactions</strong> nu exista in baza selectata.
              </p>
            )}

            {dbFileName && hasTransactionsTable && transactionsOrderedBy && (
              <p style={{ margin: 0, color: '#444' }}>
                Ordonare folosita: <strong>{transactionsOrderedBy}</strong> {sortDirection}
              </p>
            )}

            {dbFileName && hasTransactionsTable && availableTrTypes.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                <label htmlFor='tr-type-filter'>Filtru trType:</label>
                <select
                  id='tr-type-filter'
                  value={selectedTrType}
                  onChange={handleTrTypeFilterChange}
                  disabled={isTransactionsLoading}
                  style={{
                    padding: '8px 10px',
                    borderRadius: '6px',
                    border: '1px solid #ccc',
                    background: isTransactionsLoading ? '#f2f2f2' : '#fff',
                    cursor: isTransactionsLoading ? 'not-allowed' : 'pointer',
                  }}
                >
                  <option value='all'>Toate</option>
                  {availableTrTypes.map((typeValue) => (
                    <option key={typeValue} value={typeValue}>
                      {typeValue}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {dbFileName && hasTransactionsTable && availableTrEvents.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                <label htmlFor='tr-event-filter'>Filtru trEvent:</label>
                <select
                  id='tr-event-filter'
                  value={selectedTrEvent}
                  onChange={handleTrEventFilterChange}
                  disabled={isTransactionsLoading}
                  style={{
                    padding: '8px 10px',
                    borderRadius: '6px',
                    border: '1px solid #ccc',
                    background: isTransactionsLoading ? '#f2f2f2' : '#fff',
                    cursor: isTransactionsLoading ? 'not-allowed' : 'pointer',
                  }}
                >
                  <option value='all'>Toate</option>
                  {availableTrEvents.map((eventValue) => (
                    <option key={eventValue} value={eventValue}>
                      {eventValue}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {dbFileName && hasTransactionsTable && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                <label htmlFor='account-filter'>Accounts:</label>
                <select
                  id='account-filter'
                  value={selectedAccount}
                  onChange={handleAccountFilterChange}
                  disabled={isTransactionsLoading || availableAccounts.length === 0}
                  style={{
                    padding: '8px 10px',
                    borderRadius: '6px',
                    border: '1px solid #ccc',
                    background: isTransactionsLoading || availableAccounts.length === 0 ? '#f2f2f2' : '#fff',
                    cursor: isTransactionsLoading || availableAccounts.length === 0 ? 'not-allowed' : 'pointer',
                  }}
                >
                  <option value='all'>Toate</option>
                  {availableAccounts.map((accountValue) => (
                    <option key={accountValue} value={accountValue}>
                      {accountValue}
                    </option>
                  ))}
                </select>
                {availableAccounts.length === 0 && (
                  <span style={{ color: '#666' }}>Nu exista entries in Settings cu Type = "accounts".</span>
                )}
              </div>
            )}

            {dbFileName && hasTransactionsTable && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                <label htmlFor='category-filter'>Categories:</label>
                <select
                  id='category-filter'
                  value={selectedCategory}
                  onChange={handleCategoryFilterChange}
                  disabled={isTransactionsLoading || availableCategories.length === 0}
                  style={{
                    padding: '8px 10px',
                    borderRadius: '6px',
                    border: '1px solid #ccc',
                    background: isTransactionsLoading || availableCategories.length === 0 ? '#f2f2f2' : '#fff',
                    cursor: isTransactionsLoading || availableCategories.length === 0 ? 'not-allowed' : 'pointer',
                  }}
                >
                  <option value='all'>Toate</option>
                  {availableCategories.map((categoryValue) => (
                    <option key={categoryValue} value={categoryValue}>
                      {categoryValue}
                    </option>
                  ))}
                </select>
                {availableCategories.length === 0 && (
                  <span style={{ color: '#666' }}>Nu exista entries in Settings cu Type = "categories".</span>
                )}
              </div>
            )}

            {dbFileName && hasTransactionsTable && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                <label htmlFor='description-filter'>Search trDescription:</label>
                <input
                  id='description-filter'
                  type='text'
                  value={descriptionFilterInput}
                  onChange={(event) => setDescriptionFilterInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      void applyDescriptionFilter()
                    }
                  }}
                  placeholder='ex: SC'
                  disabled={isTransactionsLoading}
                  style={{
                    padding: '8px 10px',
                    borderRadius: '6px',
                    border: '1px solid #ccc',
                    minWidth: '220px',
                  }}
                />
                <button
                  onClick={() => void applyDescriptionFilter()}
                  disabled={isTransactionsLoading}
                  style={{
                    padding: '8px 12px',
                    borderRadius: '6px',
                    border: '1px solid #ccc',
                    background: isTransactionsLoading ? '#f2f2f2' : '#fff',
                    cursor: isTransactionsLoading ? 'not-allowed' : 'pointer',
                  }}
                >
                  Cauta
                </button>
                <button
                  onClick={() => void clearDescriptionFilter()}
                  disabled={isTransactionsLoading || (!appliedDescriptionFilter && !descriptionFilterInput)}
                  style={{
                    padding: '8px 12px',
                    borderRadius: '6px',
                    border: '1px solid #ccc',
                    background:
                      isTransactionsLoading || (!appliedDescriptionFilter && !descriptionFilterInput)
                        ? '#f2f2f2'
                        : '#fff',
                    cursor:
                      isTransactionsLoading || (!appliedDescriptionFilter && !descriptionFilterInput)
                        ? 'not-allowed'
                        : 'pointer',
                  }}
                >
                  Reset
                </button>
              </div>
            )}

            {dbFileName && hasTransactionsTable && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                <label htmlFor='from-date-filter'>From:</label>
                <input
                  id='from-date-filter'
                  type='date'
                  value={fromDateInput}
                  onChange={(event) => setFromDateInput(event.target.value)}
                  disabled={isTransactionsLoading}
                  style={{
                    padding: '8px 10px',
                    borderRadius: '6px',
                    border: '1px solid #ccc',
                  }}
                />

                <label htmlFor='to-date-filter'>To:</label>
                <input
                  id='to-date-filter'
                  type='date'
                  value={toDateInput}
                  onChange={(event) => setToDateInput(event.target.value)}
                  disabled={isTransactionsLoading}
                  style={{
                    padding: '8px 10px',
                    borderRadius: '6px',
                    border: '1px solid #ccc',
                  }}
                />

                <button
                  onClick={() => void applyDateRangeFilter()}
                  disabled={isTransactionsLoading}
                  style={{
                    padding: '8px 12px',
                    borderRadius: '6px',
                    border: '1px solid #ccc',
                    background: isTransactionsLoading ? '#f2f2f2' : '#fff',
                    cursor: isTransactionsLoading ? 'not-allowed' : 'pointer',
                  }}
                >
                  Aplica data
                </button>

                <button
                  onClick={() => void clearDateRangeFilter()}
                  disabled={
                    isTransactionsLoading ||
                    (!fromDateInput && !toDateInput && !appliedFromDate && !appliedToDate)
                  }
                  style={{
                    padding: '8px 12px',
                    borderRadius: '6px',
                    border: '1px solid #ccc',
                    background:
                      isTransactionsLoading ||
                      (!fromDateInput && !toDateInput && !appliedFromDate && !appliedToDate)
                        ? '#f2f2f2'
                        : '#fff',
                    cursor:
                      isTransactionsLoading ||
                      (!fromDateInput && !toDateInput && !appliedFromDate && !appliedToDate)
                        ? 'not-allowed'
                        : 'pointer',
                  }}
                >
                  Reset data
                </button>
              </div>
            )}

            {dbFileName && hasTransactionsTable && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                <label htmlFor='transactions-page-size'>Tranzactii/pagina:</label>
                <input
                  id='transactions-page-size'
                  type='number'
                  inputMode='numeric'
                  min={1}
                  max={500}
                  step={1}
                  value={transactionsPageSizeInput}
                  onChange={(event) => setTransactionsPageSizeInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      void applyTransactionsPageSize()
                    }
                  }}
                  disabled={isTransactionsLoading}
                  style={{
                    width: '100px',
                    padding: '8px 10px',
                    borderRadius: '6px',
                    border: '1px solid #ccc',
                  }}
                />
                <button
                  onClick={() => void applyTransactionsPageSize()}
                  disabled={isTransactionsLoading}
                  style={{
                    padding: '8px 12px',
                    borderRadius: '6px',
                    border: '1px solid #ccc',
                    background: isTransactionsLoading ? '#f2f2f2' : '#fff',
                    cursor: isTransactionsLoading ? 'not-allowed' : 'pointer',
                  }}
                >
                  Aplica
                </button>

                <button
                  onClick={() => handleTransactionsPageChange(Math.max(0, transactionsOffset - transactionsPageSize))}
                  disabled={!canGoPrev || isTransactionsLoading}
                  style={{
                    padding: '8px 12px',
                    borderRadius: '6px',
                    border: '1px solid #ccc',
                    background: !canGoPrev || isTransactionsLoading ? '#f2f2f2' : '#fff',
                    cursor: !canGoPrev || isTransactionsLoading ? 'not-allowed' : 'pointer',
                  }}
                >
                  Prev
                </button>

                <button
                  onClick={() => handleTransactionsPageChange(transactionsOffset + transactionsPageSize)}
                  disabled={!canGoNext || isTransactionsLoading}
                  style={{
                    padding: '8px 12px',
                    borderRadius: '6px',
                    border: '1px solid #ccc',
                    background: !canGoNext || isTransactionsLoading ? '#f2f2f2' : '#fff',
                    cursor: !canGoNext || isTransactionsLoading ? 'not-allowed' : 'pointer',
                  }}
                >
                  Next
                </button>

                <span style={{ color: '#666' }}>
                  {isTransactionsLoading
                    ? 'Incarcare tranzactii...'
                    : `Afisare ${transactionsStart}-${transactionsEnd} din ${transactionsTotalRows}`}
                </span>
              </div>
            )}

            {dbFileName && hasTransactionsTable && transactionsRows.length === 0 && (
              <p style={{ margin: 0, color: '#666' }}>
                Nu exista tranzactii in tabel.
              </p>
            )}

            {transactionsRows.length > 0 && (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ borderCollapse: 'collapse', minWidth: '640px', width: '100%' }}>
                  <thead>
                    <tr>
                      {['Date', 'Type', 'For', 'Description', 'Value'].map((columnName) => (
                        <th
                          key={columnName}
                          style={{
                            textAlign: columnName === 'Value' ? 'right' : 'left',
                            borderBottom: '1px solid #ddd',
                            padding: '8px',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {columnName === 'Date' || columnName === 'Value' ? (
                            <button
                              type='button'
                              onClick={() => handleSortClick(columnName === 'Date' ? 'date' : 'value')}
                              style={{
                                border: 'none',
                                background: 'transparent',
                                padding: 0,
                                cursor: 'pointer',
                                font: 'inherit',
                                color: 'inherit',
                                textAlign: columnName === 'Value' ? 'right' : 'left',
                              }}
                            >
                              <div>{columnName}</div>
                              <div>
                                {sortColumn === (columnName === 'Date' ? 'date' : 'value')
                                  ? sortDirection === 'asc'
                                    ? '(asc)'
                                    : '(desc)'
                                  : ''}
                              </div>
                              {columnName === 'Value' && (
                                <div style={{ fontSize: '11px', color: '#666', marginTop: '2px', lineHeight: 1.2 }}>
                                  <div>Base: {VALUE_SUM_FORMATTER.format(sumTrValueBase)}</div>
                                  <div>Ref: {VALUE_SUM_FORMATTER.format(sumTrValueRef)}</div>
                                </div>
                              )}
                            </button>
                          ) : (
                            columnName
                          )}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {transactionDisplayRows.map((row, rowIndex) => (
                      <tr key={`txn-${rowIndex}`}>
                        {[row.date, row.type, row.for, row.description, row.value].map((cellValue, cellIndex) => (
                          <td
                            key={`txn-${rowIndex}-${cellIndex}`}
                            style={{
                              borderBottom: '1px solid #f0f0f0',
                              padding: '8px',
                              whiteSpace: 'nowrap',
                              textAlign: cellIndex === 4 ? 'right' : 'left',
                            }}
                          >
                            {cellValue}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
        {activeMenu === 'setari' && <p>Setarile aplicatiei.</p>}
      </section>
    </div>
  )
}

export default App
