/**
 * Resolves each legacy Geniuslink slug and compares the destination with the
 * expected URL from the CSV.
 *
 * Usage: bun tools/resolve-legacy.ts [csvPath] [--label us|jp]
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { mapLimit, readLinkCsv } from './lib/csv.ts'

interface Resolved {
  old_slug: string
  slug: string
  status: number
  location: string | null
  expected: string
  match: boolean
  note?: string
}

async function main() {
  const args = process.argv.slice(2)
  let label = 'us'
  const positional: string[] = []
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!
    if (arg === '--label') {
      label = args[++i] ?? ''
      continue
    }
    if (arg.startsWith('--label=')) {
      label = arg.slice('--label='.length)
      continue
    }
    positional.push(arg)
  }
  if (label !== 'us' && label !== 'jp') {
    process.stderr.write(`--label must be "us" or "jp", got "${label}"\n`)
    process.exit(1)
  }

  const csvPath = resolve(process.cwd(), positional[0] ?? 'tmp/links.csv')
  const outPath = resolve(process.cwd(), `tmp/resolved-${label}.json`)
  const rows = await readLinkCsv(csvPath)

  const ASIN_REGEX = /\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i

  function asinOf(url: string): string | null {
    return url.match(ASIN_REGEX)?.[1]?.toUpperCase() ?? null
  }

  function tagOf(url: string): string | null {
    try {
      return new URL(url).searchParams.get('tag')
    }
    catch {
      return null
    }
  }

  const results = await mapLimit(rows, 3, async (row): Promise<Resolved> => {
    const slug = row.slug || row.old_slug
    const expected = label === 'jp' ? row.url_jp : row.url
    const base: Resolved = { old_slug: row.old_slug, slug, status: 0, location: null, expected, match: false }

    if (!row.old_slug)
      return { ...base, note: 'old_slug is empty' }

    let status = 0
    let location: string | null = null
    try {
      const response = await fetch(`https://geni.us/${row.old_slug}`, {
        redirect: 'manual',
        headers: { 'user-agent': 'Mozilla/5.0' },
      })
      status = response.status
      location = response.headers.get('location')
    }
    catch (error) {
      return { ...base, note: `request failed: ${error}` }
    }

    if (!location)
      return { ...base, status, note: 'no Location header' }
    if (!expected)
      return { ...base, status, location, note: `csv has no expected url for label ${label}` }

    const actualAsin = asinOf(location)
    const expectedAsin = asinOf(expected)
    if (!actualAsin || !expectedAsin)
      return { ...base, status, location, note: `could not parse ASIN from ${!actualAsin ? 'location' : 'expected url'}` }

    const actualTag = tagOf(location)
    const expectedTag = tagOf(expected)
    if (actualAsin !== expectedAsin)
      return { ...base, status, location, note: `ASIN ${actualAsin} != ${expectedAsin}` }
    if (actualTag !== expectedTag)
      return { ...base, status, location, note: `tag ${actualTag ?? '(none)'} != ${expectedTag ?? '(none)'}` }

    return { ...base, status, location, match: true }
  })

  await mkdir(dirname(outPath), { recursive: true })
  await writeFile(outPath, `${JSON.stringify(results, null, 2)}\n`, 'utf8')

  const width = Math.max(4, ...results.map(result => result.slug.length))
  process.stdout.write(`${'slug'.padEnd(width)}  status  match  note\n`)
  for (const result of results)
    process.stdout.write(`${result.slug.padEnd(width)}  ${String(result.status).padStart(6)}  ${result.match ? 'yes  ' : 'no   '}  ${result.note ?? ''}\n`)

  const mismatches = results.filter(result => !result.match).length
  process.stdout.write(`${results.length} resolved, ${mismatches} mismatches, written to ${outPath}\n`)
  process.exit(mismatches > 0 ? 1 : 0)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
