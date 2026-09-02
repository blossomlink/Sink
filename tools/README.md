# tools

One-off migration scripts for moving Geniuslink short links into Sink. They run
on Bun, use only Web Standard APIs plus `node:fs` and `node:path`, and read
`tmp/links.csv` (header `old_slug,slug,url,url_jp,comment`) by default. Pass a
different CSV path as the first argument.

Bun loads `.env` automatically, so `SINK_TOKEN` and the optional
`SINK_BASE_URL` (default `https://blsm.link`) can live there.

- `convert-links.ts` validates the CSV and writes Sink import JSON to
  `tmp/links.import.json`.
- `check-links.ts` compares the CSV with the links stored in Sink and follows
  each short link to confirm the redirect target.
- `resolve-legacy.ts` resolves every `old_slug` on geni.us and compares the
  Amazon ASIN and `tag` with the expected URL, writing `tmp/resolved-<label>.json`.

## Usage

```bash
bun tools/convert-links.ts
bun tools/check-links.ts
bun tools/resolve-legacy.ts --label jp
```
