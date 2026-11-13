> **Retired (2026-11-13):** Cloudflare Access was removed; Google sign-in in the app itself (phase 4b, see [SYNC_SETUP.md](SYNC_SETUP.md)) replaces it. This page stays for reference only.

# Sign-in for the hosted app (Cloudflare Access)

Cloudflare checks who you are **before** it serves a single file of https://expenses-io.pages.dev. Anyone else gets Cloudflare's sign-in page and nothing of the app, not even its code.

**Current setup (2026-11-13):**
- Zero Trust team: `square-bush-886e` (sign-in page at `square-bush-886e.cloudflareaccess.com`)
- Access application: **expenses-io**, covering `expenses-io.pages.dev` **and** `*.expenses-io.pages.dev` (every per-upload address)
- Sign-in method: **your Cloudflare account** (the same login as the Cloudflare dashboard)
- Policy: Allow → Emails → your Gmail only
- Cost: free (Zero Trust Free plan)

In the app: Settings → **Account** shows who is signed in, with **Sign out**.

## How it was set up (to redo or change it)

1. Cloudflare dashboard → **Workers & Pages** → **expenses-io** → **Settings** → **Access policy** → **Enable**.
   Cloudflare creates an Access application, at first covering only `*.expenses-io.pages.dev`.
   (Creating a "Self-hosted" app directly doesn't work for `pages.dev` addresses: the domain dropdown only lists your own domains.)
2. **Zero Trust** → **Access** → **Applications** → **expenses-io** → **Edit** → **Public hostnames**: two rows, both with Domain `expenses-io.pages.dev`:
   - Subdomain empty: the main address
   - Subdomain `*`: every per-upload address (if `*` isn't accepted: **Switch to custom input** → `*.expenses-io.pages.dev`)
3. **Policies:** Allow → Include → Emails → your address. Nothing broader.
4. **Save**.

## Optional: other sign-in methods

Add them under **Zero Trust → Settings → Authentication → Login methods** first, then tick them in the application's **Login methods**:

- **One-time PIN:** a 6-digit code sent to your email. Easiest on a phone, no password.
- **Google:** needs a Google OAuth client (same Google Cloud project as [SYNC_SETUP.md](SYNC_SETUP.md)):
  - Authorized JavaScript origin: `https://square-bush-886e.cloudflareaccess.com`
  - Authorized redirect URI: `https://square-bush-886e.cloudflareaccess.com/cdn-cgi/access/callback`
  - Paste the client ID and secret into Cloudflare's Google login method → **Test**.

## How it behaves

| Situation | What happens |
|---|---|
| Stranger opens any `…expenses-io.pages.dev` address | Cloudflare sign-in page; the app never loads |
| You, first visit on a device | Sign in with your Cloudflare account; stays signed in for the session duration |
| Session expired, app installed | The app still opens from the device (your data is on it, offline works); Settings → **Sign in again** to get updates |
| Settings → **Sign out** | Ends the session; the next visit asks to sign in |
| `npm run deploy` | New upload is covered by the `*` row automatically; older uploads are deleted |
| Running on `localhost` | No sign-in (development only) |

The sign-in protects the website. Your data itself lives on your devices (and encrypted in Google Drive), so also keep a screen lock on your phone and computer.

## Check it from a terminal

```bash
curl -sS -o /dev/null -w "%{http_code} %{redirect_url}\n" https://expenses-io.pages.dev/
```

`302 https://square-bush-886e.cloudflareaccess.com/...` means it's protected. `200` means it isn't.

## Turn it off (after Google sign-in works)

1. Cloudflare dashboard → **Zero Trust** → **Access** → **Applications** → `expenses-io` → **Delete** (or Workers & Pages → expenses-io → Settings → Access policy → **Disable**).
2. Check: `curl -sS -o /dev/null -w "%{http_code}\n" https://expenses-io.pages.dev/` prints `200`, and the app shows its own "Sign in with Google" screen.

Without Access, anyone can download the app's code (it holds no data and no secrets). Your data is only on your devices and, encrypted, in your Drive; the server part refuses sign-ins from addresses not in `ALLOWED_EMAILS`.
