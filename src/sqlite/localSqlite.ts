import initSqlJs, { type QueryExecResult, type SqlJsStatic } from 'sql.js'
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url'

export type LocalSqliteInfo = {
  sqliteVersion: string
  tableNames: string[]
}

let sqlJsLoader: Promise<SqlJsStatic> | null = null

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

export async function inspectLocalSqlite(file: File): Promise<LocalSqliteInfo> {
  const SQL = await getSqlJs()
  const fileBuffer = await file.arrayBuffer()
  const db = new SQL.Database(new Uint8Array(fileBuffer))

  try {
    const versionResult = db.exec('SELECT sqlite_version() AS version;')
    const tableResult = db.exec(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name;",
    )

    const tableNames = tableResult[0]?.values.map((row) => String(row[0])) ?? []

    return {
      sqliteVersion: getSingleValue(versionResult, 'necunoscuta'),
      tableNames,
    }
  } finally {
    db.close()
  }
}

