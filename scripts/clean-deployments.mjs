// Deletes every Cloudflare Pages upload except the newest (the live one), so old
// per-upload addresses like https://6a74d06e.expenses-io.pages.dev stop existing.
// Runs automatically after `npm run deploy`. Usage: node scripts/clean-deployments.mjs <project>
import { execFileSync } from 'node:child_process'

const project = process.argv[2] || process.env.CF_PAGES_PROJECT || 'expenses-io'
const wrangler = (...args) => execFileSync('npx', ['wrangler@4', 'pages', 'deployment', ...args, '--project-name', project], { encoding: 'utf8' })

const deployments = JSON.parse(wrangler('list', '--environment', 'production', '--json'))
const [live, ...old] = deployments // newest first
if (!live) {
  console.log('No deployments found.')
  process.exit(0)
}
console.log(`Keeping live upload ${live.Deployment}`)
for (const d of old) {
  try {
    // --force: Wrangler otherwise asks "Are you sure?" and silently answers "no" when run from a script.
    // Safe here because the live upload is never in this list.
    const out = wrangler('delete', d.Id, '--force')
    if (!out.includes('Successfully deleted')) throw new Error(out.trim().split('\n').at(-1))
    console.log(`Deleted ${d.Deployment}`)
  } catch (err) {
    console.warn(`Could not delete ${d.Deployment}: ${String(err.message).split('\n')[0]}`)
  }
}
console.log(`Done: ${old.length} old upload${old.length === 1 ? '' : 's'} removed.`)
