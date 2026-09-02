/**
 * Compares tmp/links.csv against the links stored in a Sink instance, then
 * follows each short link to confirm it redirects to the CSV url.
 *
 * Usage: SINK_TOKEN=... bun tools/check-links.ts [csvPath]
 */
import { resolve } from 'node:path'
import { mapLimit, readLinkCsv } from './lib/csv.ts'

interface SinkLink {
  slug: string
  url: string
  geo?: Record<string, string>
}

interface ListResponse {
  links: SinkLink[]
  list_complete: boolean
  cursor?: string
}

async function main() {
  const base = (process.env.SINK_BASE_URL ?? 'https://blsm.link').replace(/\/+$/, '')
  const token = process.env.SINK_TOKEN
  if (!token) {
    process.stderr.write('SINK_TOKEN is not set\n')
    process.exit(1)
  }

  const csvPath = resolve(process.cwd(), process.argv[2] ?? 'tmp/links.csv')
  const rows = await readLinkCsv(csvPath)

  const remote = new Map<string, SinkLink>()
  let cursor: string | undefined
  while (true) {
    const url = new URL('/api/link/list', base)
    url.searchParams.set('limit', '1000')
    url.searchParams.set('status', 'all')
    if (cursor)
      url.searchParams.set('cursor', cursor)

    const response = await fetch(url, { headers: { authorization: `Bearer ${token}` } })
    if (!response.ok) {
      process.stderr.write(`list failed: ${response.status} ${await response.text()}\n`)
      process.exit(1)
    }
    const page = await response.json() as ListResponse
    for (const link of page.links)
      remote.set(link.slug.toLowerCase(), link)

    if (page.list_complete || !page.cursor)
      break
    cursor = page.cursor
  }

  const problems: string[] = []
  const csvSlugs = new Set<string>()

  for (const row of rows) {
    const slug = row.slug || row.old_slug
    const key = slug.toLowerCase()
    csvSlugs.add(key)

    const link = remote.get(key)
    if (!link) {
      problems.push(`row ${row.row} ${slug}: missing in Sink`)
      continue
    }
    if (link.url !== row.url)
      problems.push(`row ${row.row} ${slug}: url ${link.url} != csv ${row.url}`)

    const remoteJp = link.geo?.JP
    const csvJp = row.url_jp || undefined
    if (remoteJp !== csvJp)
      problems.push(`row ${row.row} ${slug}: geo.JP ${remoteJp ?? '(none)'} != csv ${csvJp ?? '(none)'}`)
  }

  for (const [key, link] of remote) {
    if (!csvSlugs.has(key))
      problems.push(`${link.slug}: present in Sink but not in the CSV`)
  }

  const redirects = await mapLimit(rows, 5, async (row) => {
    const slug = row.slug || row.old_slug
    try {
      const response = await fetch(`${base}/${slug}`, { redirect: 'manual' })
      return { slug, row, status: response.status, location: response.headers.get('location') }
    }
    catch (error) {
      return { slug, row, status: 0, location: null, error: String(error) }
    }
  })

  for (const result of redirects) {
    process.stdout.write(`${result.slug}\t${result.status}\t${result.location ?? '-'}\n`)
    if (result.status !== 302)
      problems.push(`row ${result.row.row} ${result.slug}: status ${result.status}, expected 302`)
    else if (result.location !== result.row.url)
      problems.push(`row ${result.row.row} ${result.slug}: Location ${result.location ?? '(none)'} != csv ${result.row.url}`)
  }

  for (const problem of problems)
    process.stderr.write(`${problem}\n`)

  process.stdout.write(`checked ${rows.length} csv rows against ${remote.size} Sink links: ${problems.length} problems\n`)
  process.exit(problems.length > 0 ? 1 : 0)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
