/**
 * Converts tmp/links.csv into a Sink import JSON file.
 *
 * Usage: bun tools/convert-links.ts [csvPath] [outPath]
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { isValidHttpUrl, readLinkCsv, RESERVED_SLUGS, SLUG_REGEX } from './lib/csv.ts'

interface ImportLink {
  slug: string
  url: string
  comment?: string
  geo?: Record<string, string>
}

async function main() {
  const csvPath = resolve(process.cwd(), process.argv[2] ?? 'tmp/links.csv')
  const outPath = resolve(process.cwd(), process.argv[3] ?? 'tmp/links.import.json')

  const rows = await readLinkCsv(csvPath)
  const rejects: string[] = []
  const links: ImportLink[] = []
  const seen = new Map<string, number>()

  for (const row of rows) {
    const reasons: string[] = []
    const slug = row.slug || row.old_slug
    const key = slug.toLowerCase()

    if (!slug)
      reasons.push('slug is empty')
    else if (!SLUG_REGEX.test(slug))
      reasons.push(`slug "${slug}" does not match ^[a-z0-9]+(?:-[a-z0-9]+)*$`)
    else if (RESERVED_SLUGS.has(key))
      reasons.push(`slug "${slug}" is reserved`)
    else if (seen.has(key))
      reasons.push(`slug "${slug}" duplicates row ${seen.get(key)}`)

    if (!row.url)
      reasons.push('url is empty')
    else if (!isValidHttpUrl(row.url))
      reasons.push(`url "${row.url}" is not an absolute http(s) URL`)

    if (row.url_jp && !isValidHttpUrl(row.url_jp))
      reasons.push(`url_jp "${row.url_jp}" is not an absolute http(s) URL`)

    if (reasons.length > 0) {
      rejects.push(`row ${row.row}: ${reasons.join('; ')}`)
      continue
    }

    seen.set(key, row.row)
    const link: ImportLink = { slug, url: row.url }
    if (row.comment)
      link.comment = row.comment
    if (row.url_jp)
      link.geo = { JP: row.url_jp }
    links.push(link)
  }

  if (rejects.length > 0) {
    for (const reject of rejects)
      process.stderr.write(`${reject}\n`)
    process.stderr.write(`${rejects.length} of ${rows.length} rows rejected, nothing written\n`)
    process.exit(1)
  }

  const data = {
    version: '1.0',
    exportedAt: new Date().toISOString(),
    count: links.length,
    links,
  }

  await mkdir(dirname(outPath), { recursive: true })
  await writeFile(outPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
  process.stdout.write(`wrote ${links.length} links to ${outPath}\n`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
