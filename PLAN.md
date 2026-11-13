# Expenses — Project Plan

Personal money tracker. Import bank files, auto-categorize, charts, budgets.
Runs on Mac, Windows and mobile from **one codebase**, synced through **one file on Google Drive**.

---

## Status (read this first) · updated 2026-11-13

**Done:** phases 0–6 and 4b. Live at https://expenses-io.pages.dev (Google sign-in, approved accounts only).

**Next, in order:**
1. ✅ Real Google Drive sync verified 2026-11-13: pane uploaded, Firefox downloaded, 43 category edits made in Firefox synced back to the pane.
2. ✅ All 100 transactions categorized (EFIT UNIPE → Fitness), 3 new rules.
3. ✅ Phase 5 (2026-11-13): budgets, recurring detection, tags, split transactions, CSV/Excel export.
4. ✅ Phase 4b (2026-11-13): Google sign-in in the app replaces Cloudflare Access; one sign-in per device, Drive tokens renewed by the server part (`server/auth.ts`). Allow-list: `ALLOWED_EMAILS` secret. Local dev: `npm run dev` + `npm run dev:api`.
4c. ✅ (2026-11-13, deployed a0ed4375) Add transactions by hand (Transactions → Add). A later import matches them (same account + amount, dates ≤ 5 days apart) and fills in the bank's details instead of adding a duplicate; undoing that import restores what you typed. Hand-typed ones can be edited/deleted. New Rules tab (Categories → Rules): search, edit, delete with Undo.
5. **You (optional):** phone: open the live site → sign in → passphrase → Add to Home Screen.
6. Phase 7: more banks when you add samples (CSV/Excel mapping too). Excel import needs SheetJS (install was blocked by the permission check; approve it then).
7. Not done: nothing is committed to git yet (no commits on `master`).
8. **Waiting on your choice: share with friends without typing their emails.** Each friend gets their own separate, encrypted data in their own Drive; nobody sees anyone else's.
   - **A (recommended, ~1 h):** a secret invite link (`/?invite=<code>`). Opening it lets any Google account sign in; the "invited" flag lives inside the encrypted session cookie (no database). Change the code to retire a leaked link; rotate `SESSION_SECRET` to sign everyone out. A new device needs the link again.
   - **B (~15 min):** open to any Google account (no allow-list). Strangers can use it too; no way to block one person.
   - Today: adding someone = `npx wrangler@4 pages secret put ALLOWED_EMAILS --project-name expenses-io` (all addresses, comma-separated, yours included) → `npm run deploy`.
   - Friends at other banks need phase 7 first (only Moey import exists).

**Where things are:**
- Your data (100 Moey transactions, Jan–Oct 2026, no August, all categorized) is in your Google Drive (encrypted sync file) and on every device that synced: the Claude app's browser pane and Firefox at `http://localhost:5173`, and Firefox on the live site (signed in 2026-11-13). A new device gets it by signing in and entering the passphrase.
- Bank PDFs: `samples/` (git-ignored). `npm test` also checks every real sample parses and balances.
- Nothing is committed to git yet.

**Commands:** `npm run dev` (http://localhost:5173) + `npm run dev:api` (sign-in service, needs `.dev.vars`) · `npm test` · `npm run build` · `npm run preview` (production build + real headers, :4173) · `npm run deploy` (build, upload, delete old uploads) · `./scripts/setup-signin.sh` (Google sign-in secrets; already done).

**Guides:** [DESIGN.md](DESIGN.md) design rules · [SYNC_SETUP.md](SYNC_SETUP.md) Google sign-in + Drive sync · [DEPLOY.md](DEPLOY.md) hosting · [ACCESS_SETUP.md](ACCESS_SETUP.md) old Cloudflare sign-in (retired).

---

## 1. Architecture

**Installable web app (PWA), local-first.**

```
 ┌──────────── Device (Mac / Windows / phone) ────────────┐
 │  Browser or installed PWA                               │
 │  React UI  ──►  Local DB (IndexedDB via Dexie)          │
 │                     │  works fully offline              │
 │                     ▼                                    │
 │               Sync engine (merge by record)             │
 └─────────────────────┬───────────────────────────────────┘
                       │ Google Drive API (OAuth, drive.file scope)
                       ▼
            Google Drive: /Expenses/expenses-sync.json.enc
            (+ Drive's built-in revision history = backups)
```

- **Why a PWA:** one app works on all 3 platforms. On desktop: "Install app" from Chrome/Edge. On phone: "Add to Home Screen". It opens in its own window like a native app.
- **No backend server.** Static files are hosted for free (Cloudflare Pages or GitHub Pages). Your data never touches the host, only your device and your Google Drive.
- **Offline:** everything works offline. Sync runs when you're back online.
- **Later option:** wrap the same code in Tauri for a real `.exe` / `.app` if you want one. Not needed for v1.

## 2. Tech stack

| Area | Choice |
|---|---|
| UI | Vite + React + TypeScript, Tailwind CSS + shadcn/ui (Radix), Motion for animations. Rules: [DESIGN.md](DESIGN.md) |
| Local storage | Dexie (IndexedDB) |
| Charts | Recharts |
| CSV import | Papa Parse |
| Excel import | SheetJS (from cdn.sheetjs.com, not the stale npm package) |
| PDF import | pdf.js (`pdfjs-dist`) + per-bank parser |
| PWA | `vite-plugin-pwa` (offline cache, install prompt) |
| Google sign-in + Drive | Google Identity Services (token client) + Drive REST v3 |
| Encryption | WebCrypto AES-GCM, key from passphrase (PBKDF2) |
| Tests | Vitest (logic), Playwright (import → dashboard flow) |

## 3. Data model

All records have `id` (UUID), `updatedAt`, `deleted` (soft delete). This is what makes merging between devices safe.

- **accounts** — name, type (bank / card / cash / savings), currency, default import template
- **transactions** — accountId, date, description, amount (integer cents), categoryId, tags[], notes, importBatchId, `dedupeHash`, `splitOf` (parent id), `transferPairId`
- **categories** — name, parentId (subcategories), type (income / expense), color, icon
- **rules** — field, operator (contains / starts with / regex / amount range), pattern, categoryId, priority
- **budgets** — categoryId, monthly amount, alert thresholds
- **importTemplates** — bank name, file type, column mapping, date format, decimal separator, sign convention (one amount column vs debit/credit columns), header row
- **importBatches** — filename, imported at, row count (lets you undo an import)
- **settings** — base currency, locale, sync state

## 4. Google Drive sync

- **Scope `drive.file`:** the app only sees files it created. It cannot read the rest of your Drive. This scope does not require Google app verification.
- **One file:** `/Expenses/expenses-sync.json.enc` (gzipped JSON, encrypted with your passphrase).
- **Sync steps** (on app open, after changes with a 5 s delay, and via a manual button):
  1. Download the Drive file + its `headRevisionId`
  2. Merge with local data **per record**: newest `updatedAt` wins; deletions are kept as tombstones
  3. Upload the merged file, after checking `headRevisionId` didn't change meanwhile (if it did, repeat from step 1)
- **Backups:** Drive keeps file revisions. The app also writes a dated snapshot weekly (`/Expenses/backups/2026-11-13.json.enc`), keeping the last 12.
- **Manual backup:** export / import the full JSON file from Settings, independent of Drive.

**One-time setup you do (≈15 min):** create a Google Cloud project, enable the Drive API, create an OAuth client ID (type "Web"), add the app's URL as an authorized origin. I'll write step-by-step instructions when we reach this phase.

## 5. Features

### v1 — core
1. Import CSV / Excel with column mapping, saved per bank as a template
2. Duplicate detection on re-import + undo an import batch
3. Auto-categorize with rules; correcting a category offers "create rule for this"
4. Transactions table: search, filter (date, account, category, amount, tag), bulk edit, split
5. Dashboard: spend by category (donut), income vs expense per month (bars), balance over time (line), top merchants

### v1.1 — standard extras
1. Multiple accounts + transfers between own accounts excluded from spending
2. Budgets per category, warnings at 80% / 100%
3. Recurring / subscription detection + upcoming bills
4. Tags across categories (e.g. "Vacation 2026")
5. Export to CSV / Excel

### Later
- PDF statement import (one parser per bank)
- Savings goals
- Multi-currency with exchange rates
- AI category suggestions for unknown merchants
- Net worth over time
- Dark mode, PIN / biometric lock on the app

## 6. Build phases

Times are build time in Claude Code sessions, not calendar time.

| # | Phase | Est. | Depends on |
|---|---|---|---|
| 0 | ✅ Scaffold: Vite, PWA, Dexie schema, layout, routing | done 2026-11-13 | — |
| 1 | ✅ Import: Moey PDF parser, balance check, dedupe, undo (done 2026-11-13). CSV / Excel mapping waits for those sample files | 1–2 h | **your sample files** |
| 2 | ✅ Categories editor, rules engine (+ built-in PT merchant rules), transfer pairing, transactions page (done 2026-11-13). Split and tags moved to phase 5 | 1–2 h | 1 |
| 3 | ✅ Dashboard: period picker, KPI deltas, monthly columns, category ranking, top payees, balance line, table views (done 2026-11-13) | 1 h | 2 |
| 4 | ✅ Google Drive sync + encryption, built and tested against a simulated Drive (2026-11-13). **Real Drive test waits for your client ID**: see [SYNC_SETUP.md](SYNC_SETUP.md) | 2–3 h | 0, your Google Cloud setup |
| 5 | ✅ Budgets (80% / 100% warnings, dashboard alert, suggestions), Recurring tab (weekly / 2-weekly / monthly detection, next 30 days, "not recurring"), tags (filter, bulk tag), split transactions, CSV + Excel export (built-in .xlsx writer, no library) (done 2026-11-13) | 2 h | 2 |
| 6 | ✅ Live at https://expenses-io.pages.dev (Cloudflare Pages, 2026-11-13): code splitting, CSP headers, offline + update prompt, install button, **sign-in required** (Cloudflare Access, all addresses, see [ACCESS_SETUP.md](ACCESS_SETUP.md)). Redeploy: `npm run deploy` (also deletes old uploads) | 30 min | 0 |
| 7 | PDF import for more banks (Moey done; add a parser in `src/import/parsers/`). Excel *import* needs SheetJS from cdn.sheetjs.com: its install was blocked by the permission check on 2026-11-13, so you'll need to approve it | 30–60 min per bank | sample PDFs |


## 7. Open decisions

1. ✅ **Encrypt the Drive file?** Decided: yes (default taken in phase 4). Trade-off: forgetting the passphrase means the Drive copy can't be read (local data on each device is still fine).
2. ✅ **Visible Drive folder or hidden app folder?** Decided: visible `/Expenses` folder (default taken in phase 4), so you can see and download backups yourself.
3. ✅ **Hosting:** Decided: Cloudflare Pages, project `expenses-io`. Steps in [DEPLOY.md](DEPLOY.md).
4. **Base currency and locale:** assumed EUR, `pt-PT` (comma decimals, DD/MM/YYYY). Confirm.
5. **Default categories:** I'll propose a starter list; you edit it.

## 8. Needed from you

- [ ] Sample files: 1–3 bank / card exports in `samples/` (names and IBANs can be blacked out)
- [ ] Answers to section 7
- [ ] Google Cloud OAuth client ID: follow [SYNC_SETUP.md](SYNC_SETUP.md)

## 9. Phase 4b plan: sign in to Google once (est. 1–2 h)

**Problem today:** the browser-only Google sign-in gives a token that lasts 1 hour. After that, sync pauses until you click "Sign in again". Each device also asks you to paste the client ID in Settings.

**Fix:**
1. **Client ID built into the app.** Put it in `.env.local` (`VITE_GOOGLE_CLIENT_ID`, not a secret) so every build has it. Remove the client ID field from Settings; the Sync card only shows "Connect Google Drive".
2. **Long-lived sign-in with a tiny server part.** Switch to Google's "authorization code" flow: you sign in once per device, and the app can renew access by itself for months. Renewing needs the client *secret*, which can't live in the browser, so two small Cloudflare Pages Functions handle it (free, same site, already behind Cloudflare Access):
   - `/api/google/exchange`: turns the one-time sign-in code into tokens and keeps the refresh token in a secure, http-only cookie for this site.
   - `/api/google/token`: gives the app a fresh 1-hour token whenever it needs one, without a popup.
   The client secret is stored as a Cloudflare secret, never in the code or the browser.
3. **Publish the Google app** (Audience → Publish app). In "Testing" mode Google expires these long-lived sign-ins after 7 days. `drive.file` is a non-sensitive scope, so publishing needs no Google review, and the Test users list stops mattering.
4. Local development runs the functions with `wrangler pages dev`.

**You'll need to:** create a new client secret in Google Cloud (Clients → your client → **Add secret**; the old one can't be viewed any more), store it in Cloudflare (one command), and click Publish app.

