#!/usr/bin/env bash
# One-time setup of Google sign-in (phase 4b). Asks for the values, then:
#  - stores them as encrypted secrets in the Cloudflare Pages project
#  - writes .dev.vars (git-ignored) so `npm run dev:api` works on this computer
# The client secret is typed hidden and never printed.
set -euo pipefail
cd "$(dirname "$0")/.."
PROJECT="${CF_PAGES_PROJECT:-expenses-io}"

echo "Google sign-in setup for Cloudflare Pages project: $PROJECT"
echo
read -r -p "1/3 Google OAuth client ID (ends with .apps.googleusercontent.com): " CLIENT_ID
[[ "$CLIENT_ID" == *.apps.googleusercontent.com ]] || { echo "That doesn't look like a client ID."; exit 1; }
read -r -s -p "2/3 Google client secret (typing is hidden): " CLIENT_SECRET; echo
[[ -n "$CLIENT_SECRET" ]] || { echo "Empty secret."; exit 1; }
read -r -p "3/3 Google address(es) allowed to sign in, comma-separated: " ALLOWED
[[ "$ALLOWED" == *@* ]] || { echo "Add at least one email address."; exit 1; }
SESSION_SECRET="$(openssl rand -base64 48 | tr -d '\n')"

put() { printf '%s' "$2" | npx --yes wrangler@4 pages secret put "$1" --project-name "$PROJECT" >/dev/null && echo "  ✓ $1"; }
echo
echo "Saving secrets in Cloudflare…"
put GOOGLE_CLIENT_ID "$CLIENT_ID"
put GOOGLE_CLIENT_SECRET "$CLIENT_SECRET"
put ALLOWED_EMAILS "$ALLOWED"
put SESSION_SECRET "$SESSION_SECRET"

umask 077
cat > .dev.vars <<VARS
GOOGLE_CLIENT_ID=$CLIENT_ID
GOOGLE_CLIENT_SECRET=$CLIENT_SECRET
ALLOWED_EMAILS=$ALLOWED
SESSION_SECRET=$(openssl rand -base64 48 | tr -d '\n')
PUBLIC_ORIGIN=http://localhost:5173
VARS
echo "  ✓ .dev.vars written for local development (git-ignored, only you can read it)"
echo
echo "Done. Next: npm run deploy"
