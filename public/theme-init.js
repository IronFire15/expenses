// Runs before anything else on the page.

// 1. Cloudflare gives every upload its own address (e.g. 6a74d06e.expenses-io.pages.dev).
//    Send those to the main address: it has the sign-in, and your data lives there
//    (each address has separate storage, so using a per-upload one would look empty).
;(function () {
  var m = location.hostname.match(/^[^.]+\.([^.]+\.pages\.dev)$/)
  if (m) location.replace('https://' + m[1] + location.pathname + location.search + location.hash)
})()

// 2. Apply the saved theme before first paint so there is no light/dark flash.
//    A separate file (not inline) so the Content-Security-Policy can forbid inline scripts.
;(function () {
  try {
    var t = localStorage.getItem('theme') || 'system'
    var dark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
    if (dark) document.documentElement.classList.add('dark')
  } catch {}
})()

// 3. An update is under way (you tapped Reload): the loading screen says "Updating…" until the app is open.
;(function () {
  try {
    if (sessionStorage.getItem('expenses.updating')) document.documentElement.setAttribute('data-updating', '')
  } catch {}
})()
