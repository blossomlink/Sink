# blsm.link

This fork runs Sink as the short-link service for Yuka's YouTube channel at https://blsm.link. It replaces Geniuslink. This file is the operating manual for anyone (or any agent) working on that deployment. Secrets are never in this repository; they live in the shared password manager.

## What it does

- A short link such as `https://blsm.link/<slug>` sends the visitor to an Amazon product page with a 302 redirect.
- Each link has a default URL (the amazon.com page with the US Associates tag) and a JP rule under `geo.JP` (the amazon.co.jp page with the JP tag). Visitors in Japan get the JP page; everyone else gets the default. Paste the full SiteStripe URL for each; the service does not add or rewrite tags.
- `https://blsm.link/` and any unknown slug redirect to https://www.youtube.com/@yuka.
- Clicks show up in the dashboard analytics within a minute or two.

## Dashboard

Open https://blsm.link/dashboard and enter the site token as the password. There are no user accounts; everyone shares the one token. The dashboard shows `root@blsm.link` as the signed-in user, which is a placeholder, not a mailbox.

Rules that apply when creating or editing links:

- Slugs are lowercase letters, digits, and single hyphens between groups (`^[a-z0-9]+(-[a-z0-9]+)*$`). Uppercase in a request still resolves, because slugs are matched case-insensitively. `dashboard` is reserved.
- An edit takes up to 60 seconds to reach visitors (link cache TTL).
- Import (Links page, Import button, or `POST /api/link/import`) skips slugs that already exist. To correct an imported link, delete it first, then import again. The API accepts up to 100 links per call.
- A JSON export (Links page, Export button) is the backup to keep locally. D1 is the authoritative store and a cron job writes daily backups to R2.

## Managing links from an agent

The REST API does everything the dashboard does. `skills/sink/SKILL.md` documents the endpoints; use base URL `https://blsm.link` and the token from `SINK_TOKEN` in `.env` as the Bearer token. For example, to create a link with a JP rule:

```bash
http POST https://blsm.link/api/link/create "Authorization: Bearer $SINK_TOKEN" \
  slug=my-item url='https://www.amazon.com/dp/XXXXXXXXXX?tag=us-tag-20' \
  geo:='{"JP":"https://www.amazon.co.jp/dp/XXXXXXXXXX?tag=jp-tag-22"}' comment='Video title'
```

Edit with `PUT /api/link/edit` (send the full link including `geo`), delete with `POST /api/link/delete` and `{"slug": "..."}`. One correction to the skill: `GET /api/link/list` returns `{ links, list_complete, cursor }`, not `{ keys }`.

## Deployment layout

- Cloudflare account: Blossomlink. Worker name: `sink`. Custom domain `blsm.link` is declared in `wrangler.jsonc`; `workers.dev` and preview URLs are disabled there too.
- Resources, all named `sink`: D1 database, KV namespace, R2 bucket, Analytics Engine dataset. Their IDs are set as Workers Builds variables (`DEPLOY_D1_DATABASE_ID`, `DEPLOY_KV_NAMESPACE_ID`, `DEPLOY_R2_BUCKET_NAME`), not in this repo.
- Workers Builds watches the `blossomlink` branch of `blossomlink/Sink`. Build command `pnpm build`, deploy command `pnpm deploy:worker` (which also applies D1 migrations). Every push to `blossomlink` deploys.
- Runtime variables in `wrangler.jsonc` (`vars`): `NUXT_REDIRECT_STATUS_CODE=302`, `NUXT_CF_ACCOUNT_ID`, `NUXT_HOME_URL`, `NUXT_NOT_FOUND_REDIRECT`. Secrets on the Worker: `NUXT_SITE_TOKEN` (dashboard password) and `NUXT_CF_API_TOKEN` (Account Analytics: Read). Set secrets with `bunx wrangler secret put <NAME> --name sink`; Cloudflare never displays them again.
- Analytics Engine must stay enabled on the account or deploys fail with error 10089.

## Branches and upgrades

`master` mirrors upstream `miantiao-me/Sink` and carries no local changes. Everything for blsm.link lives on `blossomlink`. To upgrade:

1. Sync `master` from upstream on GitHub (Sync fork), or `git fetch upstream && git push origin upstream/master:master`.
2. `git checkout blossomlink && git rebase master`. Conflicts, if any, are usually in `wrangler.jsonc`, `package.json`, or `pnpm-lock.yaml`.
3. `git push --force-with-lease origin blossomlink`. Workers Builds deploys.
4. Open Dashboard, Links once and spot-check one redirect.

## Local tools

`tools/` holds bun scripts used for the Geniuslink migration and for checking the live site. They read `SINK_TOKEN` from `.env` (same value as `NUXT_SITE_TOKEN`; see `.env.example`). Usage is in `tools/README.md`. The inventory file `tmp/links.csv` and any export JSON hold affiliate tags and must never be committed; `tmp/` is gitignored.

## Checking that it works

```bash
http GET https://blsm.link/<slug>      # expect 302 and a Location header (httpie does not follow redirects by default)
bun tools/check-links.ts                            # compares Sink with tmp/links.csv and follows every slug
```

Cloudflare build logs are in the dashboard under the Worker's Deployments tab. Wrangler's OAuth login cannot read them.
