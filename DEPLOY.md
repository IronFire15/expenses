# Put the app online

The app is a set of static files (HTML, JS, CSS). The host only serves those files: **your financial data never goes to the host.** It stays on each device and in your Google Drive (encrypted).

Recommended host: **Cloudflare Pages**. It's free, fast worldwide, gives an `https://` address (required for installing on a phone), and applies the app's security headers (`dist/_headers`).

## First deploy (about 10 minutes)

1. Create a free account at <https://dash.cloudflare.com/sign-up> (skip if you have one).
2. In the project folder, sign the command-line tool in to your account (opens your browser):
   ```bash
   npx wrangler@4 login
   ```
3. Pick a project name. It becomes your address: `https://<name>.pages.dev`. Names are global, so plain `expenses` is probably taken; try something like `expenses-io`.
4. Build and upload:
   ```bash
   npm run deploy
   ```
   The first time, Wrangler asks to create the project. Answer **yes**, production branch `main`.
5. Open the printed `https://….pages.dev` address.

## After the first deploy

- **Google sign-in:** add the new address to **Authorized JavaScript origins** in Google Cloud (see [SYNC_SETUP.md](SYNC_SETUP.md), step 4), e.g. `https://expenses-io.pages.dev`.
- **Google sign-in:** the `functions/` folder is deployed with the site (Pages Functions under `/api/auth/*`). Its settings are Cloudflare secrets set by `./scripts/setup-signin.sh` ([SYNC_SETUP.md](SYNC_SETUP.md) step 5); they apply from the next deploy.
- **Install:**
  - **iPhone / iPad:** open the address in Safari → Share → **Add to Home Screen**.
  - **Android:** Chrome → menu → **Install app**.
  - **Windows / Mac (Chrome or Edge):** install icon at the right of the address bar, or Settings → **Install app**.
  - **Mac Safari:** File → **Add to Dock**.
- **Updates:** run `npm run deploy` again. Open apps show "A new version is ready → Reload".
- **Per-upload addresses:** Cloudflare gives each upload its own address (`https://<hash>.expenses-io.pages.dev`). `npm run deploy` deletes all older uploads afterwards (`scripts/clean-deployments.mjs`), and the app redirects the live upload's address to the main one. To block that last one for strangers too, the Access app must also cover `*.expenses-io.pages.dev` ([ACCESS_SETUP.md](ACCESS_SETUP.md)).

## Sign-in

The hosted app should require your sign-in (Google or an email code), enforced by Cloudflare before any file is served. Steps: [ACCESS_SETUP.md](ACCESS_SETUP.md).

## What gets uploaded

Only `dist/`: the built app. `samples/` (your bank statements), `.env.local` and `node_modules` are never part of it.

## Checks before each deploy

```bash
npm test && npm run build && npm run preview
```

`npm run preview` serves the exact built files with the same security headers on <http://localhost:4173>.
