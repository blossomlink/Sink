import { readFile } from 'node:fs/promises'

export interface CsvRow {
  /** 1-based row number in the source file, header included. */
  row: number
  old_slug: string
  slug: string
  url: string
  url_jp: string
  comment: string
}

const COLUMNS = ['old_slug', 'slug', 'url', 'url_jp', 'comment'] as const

/** RFC 4180 parser: quoted fields, embedded commas/newlines, doubled quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let field = ''
  let record: string[] = []
  let quoted = false
  let i = 0
  let dirty = false

  const endField = () => {
    record.push(field)
    field = ''
    dirty = false
  }
  const endRecord = () => {
    endField()
    rows.push(record)
    record = []
  }

  const input = text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text

  while (i < input.length) {
    const char = input[i]
    if (quoted) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        quoted = false
        i += 1
        continue
      }
      field += char
      i += 1
      continue
    }
    if (char === '"' && !dirty) {
      quoted = true
      dirty = true
      i += 1
      continue
    }
    if (char === ',') {
      endField()
      i += 1
      continue
    }
    if (char === '\r' && input[i + 1] === '\n') {
      endRecord()
      i += 2
      continue
    }
    if (char === '\n' || char === '\r') {
      endRecord()
      i += 1
      continue
    }
    field += char
    dirty = true
    i += 1
  }

  if (field !== '' || record.length > 0 || quoted)
    endRecord()

  return rows.filter(r => r.length > 1 || (r[0] ?? '').trim() !== '')
}

export async function readLinkCsv(path: string): Promise<CsvRow[]> {
  const rows = parseCsv(await readFile(path, 'utf8'))
  if (rows.length === 0)
    throw new Error(`${path} is empty`)

  const header = rows[0]!.map(cell => cell.trim().toLowerCase())
  for (const column of COLUMNS) {
    if (!header.includes(column))
      throw new Error(`${path} is missing the "${column}" column (header: ${header.join(',')})`)
  }
  const index = Object.fromEntries(COLUMNS.map(column => [column, header.indexOf(column)])) as Record<typeof COLUMNS[number], number>

  return rows.slice(1).map((cells, offset) => ({
    row: offset + 2,
    old_slug: (cells[index.old_slug] ?? '').trim(),
    slug: (cells[index.slug] ?? '').trim(),
    url: (cells[index.url] ?? '').trim(),
    url_jp: (cells[index.url_jp] ?? '').trim(),
    comment: (cells[index.comment] ?? '').trim(),
  }))
}

export const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/i
export const RESERVED_SLUGS = new Set(['dashboard'])

export function isValidHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  }
  catch {
    return false
  }
}

/** Runs tasks with a fixed concurrency limit, preserving input order in the result. */
export async function mapLimit<T, R>(items: T[], limit: number, task: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = Array.from({ length: items.length }) as R[]
  let next = 0
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (true) {
      const index = next++
      if (index >= items.length)
        return
      results[index] = await task(items[index]!, index)
    }
  })
  await Promise.all(workers)
  return results
}
