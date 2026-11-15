import { type ChangeEvent, useEffect, useRef, useState } from 'react'
import { inspectLocalSqlite } from './sqlite/localSqlite'

type MenuItem = 'dashboard' | 'comenzi' | 'setari'

function App() {
  const [activeMenu, setActiveMenu] = useState<MenuItem>('dashboard')
  const [isCommandsOpen, setIsCommandsOpen] = useState(false)
  const [isDbLoading, setIsDbLoading] = useState(false)
  const [dbFileName, setDbFileName] = useState('')
  const [dbInfoMessage, setDbInfoMessage] = useState('Nicio baza SQLite incarcata.')
  const [dbTables, setDbTables] = useState<string[]>([])
  const [dbError, setDbError] = useState('')
  const menuContainerRef = useRef<HTMLDivElement | null>(null)
  const sqliteInputRef = useRef<HTMLInputElement | null>(null)

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

  const handleSqliteFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0]

    if (!selectedFile) {
      return
    }

    setIsDbLoading(true)
    setDbError('')
    setDbTables([])
    setDbFileName(selectedFile.name)

    try {
      const dbInfo = await inspectLocalSqlite(selectedFile)

      setDbInfoMessage(`Baza deschisa cu succes. SQLite versiune: ${dbInfo.sqliteVersion}`)
      setDbTables(dbInfo.tableNames)
    } catch {
      setDbInfoMessage('Nu s-a putut citi baza selectata.')
      setDbError('Verifica daca fisierul este o baza SQLite valida (.db, .sqlite, .sqlite3).')
    } finally {
      setIsDbLoading(false)
      event.target.value = ''
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
                accept='.db,.sqlite,.sqlite3,application/x-sqlite3'
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
          </div>
        )}
        {activeMenu === 'setari' && <p>Setarile aplicatiei.</p>}
      </section>
    </div>
  )
}

export default App
