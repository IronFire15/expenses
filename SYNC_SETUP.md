# Google sign-in and Drive sync: setup

You sign in to the app with Google **once per device**. The same sign-in gives the app access to its own sync file in your Drive. No client ID to paste, no hourly "sign in again".

**What the app can access:** only files it creates itself (`drive.file` scope): the `Expenses` folder. Never the rest of your Drive.

**Who can sign in:** only the Google addresses you list in `ALLOWED_EMAILS` (step 5). Anyone else is turned away by the server.

**How it works:** a small server part (Cloudflare Pages Functions, `functions/` + `server/auth.ts`) does the Google sign-in and keeps the long-lived sign-in in an encrypted, http-only cookie on your device. The app asks it for a fresh 1-hour Drive token whenever it needs one. The client secret stays on Cloudflare, never in the app or the browser.

---

## 1. Create a project

1. Open <https://console.cloud.google.com/> and sign in with the Google account whose Drive you want to use.
2. Top bar → project picker → **New project**.
3. Name: `Expenses` → **Create**. Make sure it's selected in the top bar afterwards.

## 2. Turn on the Drive API

1. Menu → **APIs & Services** → **Library**.
2. Search **Google Drive API** → open it → **Enable**.

## 3. Set up the sign-in screen

1. Menu → **Google Auth Platform** (older consoles: **APIs & Services → OAuth consent screen**) → **Get started**.
2. App name: `Expenses`. User support email: your email. → **Next**.
3. Audience: **External** → **Next**.
4. Contact email: your email → **Next** → agree → **Create**.
5. **Audience** page → **Publish app** → **Confirm** (status becomes "In production").
   Needed: in "Testing" mode Google ends long-lived sign-ins after 7 days. `openid`, `email` and `drive.file` are non-sensitive scopes, so publishing needs no Google review. Who can sign in is still limited by `ALLOWED_EMAILS`.
6. **Data access** page → **Add or remove scopes** → find `.../auth/drive.file` ("See, edit, create and delete only the specific Google Drive files you use with this app") → tick it → **Update** → **Save**.

## 4. Create the client ID and secret

1. **Clients** page (older consoles: **APIs & Services → Credentials**) → **Create client** (or open your existing `Expenses web` client).
2. Application type: **Web application**. Name: `Expenses web`.
3. **Authorized redirect URIs** → **Add URI**, both:
   - `https://expenses-io.pages.dev/api/auth/callback`
   - `http://localhost:5173/api/auth/callback` (running the app on this computer)
   **Authorized JavaScript origins** are no longer needed (the old browser-only sign-in used them); leaving them does no harm.
4. **Save**. Copy the **Client ID**.
5. **Client secrets** → **Add secret** → copy it right away (Google only shows it once). Don't paste it anywhere except the setup script below.

## 5. Store the settings in Cloudflare (one command)

In the project folder:

```bash
./scripts/setup-signin.sh
```

It asks for the client ID, the client secret (typing is hidden) and the Google address(es) allowed to sign in, then saves them as encrypted Cloudflare secrets (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `ALLOWED_EMAILS`, plus a random `SESSION_SECRET`) and writes `.dev.vars` for local development (git-ignored).

Then publish: `npm run deploy`. Secrets take effect on the next deploy.

To change who can sign in later: `npx wrangler@4 pages secret put ALLOWED_EMAILS --project-name expenses-io`, then `npm run deploy`. Someone removed from the list is signed out the next time their app asks for a token.

## 6. Sign in and turn sync on

1. Open the app → **Sign in with Google** → pick your account → allow access (leave the Google Drive box ticked).
2. **First device:** choose a passphrase (12+ characters; a few random words work well). Save it in your password manager.
   Your data is encrypted with it, then uploaded to `My Drive / Expenses / expenses-sync.json.enc`.
3. **Every other device:** sign in → enter the same passphrase → it downloads and merges.

## Running on this computer

Two terminals: `npm run dev` (the app, :5173) and `npm run dev:api` (the sign-in service, :8788; run `npm run build` once first). Vite forwards `/api` to it. Without `dev:api`, the sign-in screen offers **Continue without sign-in (development only)**.

## How it behaves

| Situation | What happens |
|---|---|
| You change something | Uploaded about 5 s later |
| You open the app / come back to it | Downloads changes from your other devices |
| Two devices edited different things | Both kept |
| Two devices edited the same item | The newer edit wins |
| Offline | The app opens (if you signed in on this device before) and everything works; syncs when you're back online |
| Days or weeks later | Still signed in: each use renews the sign-in (up to 400 days idle) |
| You remove the app's access in your Google account, or change your Google password | The app asks you to sign in again |
| Weekly | Dated copy in `Expenses / backups`, last 12 kept |
| Lost passphrase | Drive copy can't be opened. Data on your devices is fine: turn sync off, delete the Drive file, turn it on with a new passphrase |

## Troubleshooting

- **"Error 400: redirect_uri_mismatch":** the callback address isn't in **Authorized redirect URIs** (step 4.3). Add it exactly. Changes can take a few minutes.
- **"That Google account isn't allowed":** the address isn't in `ALLOWED_EMAILS` (step 5).
- **"The sign-in service isn't answering (not_configured)":** the Cloudflare secrets are missing: run step 5, then `npm run deploy`.
- **"Google didn't complete the sign-in":** often a wrong client secret. Create a new one (step 4.5) and run step 5 again.
- **Signed out after 7 days:** the Google app is still in "Testing": publish it (step 3.5).
