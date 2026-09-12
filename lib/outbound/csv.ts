// ============================================================================
// CSV → prospect rows
// ============================================================================
// Small dependency-free CSV parser (quoted fields, embedded commas/newlines)
// plus header mapping to prospect fields via case-insensitive aliases.
// ============================================================================

import type { ProspectInput } from './db'

// Parse CSV text into an array of string cells per row.
function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  const s = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')

  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++ }
        else inQuotes = false
      } else field += c
    } else if (c === '"') {
      inQuotes = true
    } else if (c === ',') {
      row.push(field); field = ''
    } else if (c === '\n') {
      row.push(field); rows.push(row); row = []; field = ''
    } else {
      field += c
    }
  }
  // last field/row
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row) }
  return rows.filter((r) => r.some((c) => c.trim() !== ''))
}

const HEADER_ALIASES: Record<keyof ProspectInput, string[]> = {
  company_name: ['company_name', 'company', 'operator', 'business', 'dmc'],
  contact_name: ['contact_name', 'name', 'contact', 'full_name', 'first_name'],
  contact_email: ['contact_email', 'email', 'e-mail', 'email_address'],
  role_title: ['role_title', 'role', 'title', 'position'],
  destination: ['destination', 'destinations', 'country', 'location', 'market'],
  signal: ['signal', 'observation', 'note', 'notes', 'reason', 'trigger'],
}

function matchField(header: string): keyof ProspectInput | null {
  const h = header.trim().toLowerCase().replace(/\s+/g, '_')
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    if (aliases.includes(h)) return field as keyof ProspectInput
  }
  return null
}

export interface CsvParseResult {
  rows: ProspectInput[]
  headerFound: boolean
  emailColumnFound: boolean
}

export function parseProspectsCsv(text: string): CsvParseResult {
  const table = parseCsv(text)
  if (table.length === 0) return { rows: [], headerFound: false, emailColumnFound: false }

  const header = table[0]
  const colMap: Array<keyof ProspectInput | null> = header.map(matchField)
  const emailColumnFound = colMap.includes('contact_email')
  const headerFound = colMap.some((c) => c !== null)

  if (!headerFound || !emailColumnFound) {
    return { rows: [], headerFound, emailColumnFound }
  }

  const rows: ProspectInput[] = []
  for (let i = 1; i < table.length; i++) {
    const cells = table[i]
    const rec: Partial<ProspectInput> = {}
    colMap.forEach((field, idx) => {
      if (field && cells[idx] != null) {
        const v = cells[idx].trim()
        if (v) (rec as Record<string, string>)[field] = v
      }
    })
    if (rec.contact_email) rows.push(rec as ProspectInput)
  }
  return { rows, headerFound, emailColumnFound }
}
