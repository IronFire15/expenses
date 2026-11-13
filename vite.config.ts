/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { writeFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

/**
 * Content-Security-Policy: only this site's own scripts run. Network access is limited to this site
 * (incl. its /api sign-in service) and the Google Drive API, so even injected code couldn't send
 * your data anywhere else. Google sign-in is a full-page visit, so no Google scripts or frames.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'", // inline style attributes (animations)
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self' https://www.googleapis.com",
  "frame-src 'none'",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ')

const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy': CSP,
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
}

/** Writes dist/_headers (Cloudflare Pages / Netlify format) with the security and cache headers. */
function hostingHeaders(): Plugin {
  return {
    name: 'hosting-headers',
    apply: 'build',
    closeBundle() {
      const lines = [
        '/*',
        ...Object.entries(SECURITY_HEADERS).map(([k, v]) => `  ${k}: ${v}`),
        '  Strict-Transport-Security: max-age=31536000; includeSubDomains',
        '',
        '# Hashed file names never change content: cache for a year.',
        '/assets/*',
        '  Cache-Control: public, max-age=31536000, immutable',
        '',
        '# Always check for a new app version.',
        '/sw.js',
        '  Cache-Control: no-cache',
        '/index.html',
        '  Cache-Control: no-cache',
        '',
      ]
      writeFileSync(fileURLToPath(new URL('./dist/_headers', import.meta.url)), lines.join('\n'))
    },
  }
}

/** The sign-in service (Pages Functions) runs separately in development: `npm run dev:api` on :8788. */
const API_PROXY = { '/api': { target: 'http://localhost:8788', changeOrigin: false } }

export default defineConfig({
  server: { proxy: API_PROXY },
  // `npm run preview` serves the production build with the same headers as the real host.
  preview: { headers: SECURITY_HEADERS, proxy: API_PROXY },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  plugins: [
    react(),
    tailwindcss(),
    hostingHeaders(),
    VitePWA({
      // 'prompt': a new version waits until you tap Reload, so it never interrupts what you're doing.
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'apple-touch-icon-180x180.png'],
      manifest: {
        name: 'Expenses',
        short_name: 'Expenses',
        description: 'Personal money tracker: import bank files, categorize, see where it goes.',
        theme_color: '#0f766e',
        background_color: '#ffffff',
        id: '/',
        scope: '/',
        display: 'standalone',
        start_url: '/',
        categories: ['finance', 'productivity'],
        shortcuts: [
          { name: 'Import statements', short_name: 'Import', url: '/import', icons: [{ src: 'pwa-192x192.png', sizes: '192x192' }] },
          { name: 'Transactions', url: '/transactions', icons: [{ src: 'pwa-192x192.png', sizes: '192x192' }] },
        ],
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        navigateFallback: '/index.html',
        // Google sign-in (/api/auth/start, /callback) must always reach the server, never the cached app.
        // The privacy and terms pages are their own HTML files, not part of the app.
        navigateFallbackDenylist: [/^\/api\//, /^\/(privacy|terms)(\.html)?$/],
        globPatterns: ['**/*.{js,mjs,css,html,svg,png,woff2}'],
        // pdf.js worker is ~1 MB; precache it so PDF import works offline.
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
    }),
  ],
  test: {
    environment: 'node',
  },
})
