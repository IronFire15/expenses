# Design rules

Every new screen follows these. If a rule gets in the way, change the rule here first.

## Foundations

| Area | Rule | Where |
|---|---|---|
| Colors | Only semantic tokens (`bg-card`, `text-muted-foreground`, `text-primary`, `text-positive`). No raw Tailwind colors like `bg-zinc-100`. | `src/index.css` |
| Brand | Teal. Light: teal-700 (5.5:1 with white). Dark: teal-400 with dark text. | `--primary` |
| Money colors | Income = `text-positive` (green). Expenses = normal text color. Red (`--negative`) only for warnings like over-budget. | — |
| Font | Geist Variable, bundled (works offline). Numbers use `tabular-nums` so digits line up. | `@fontsource-variable/geist` |
| Radius | `rounded-xl` cards, `rounded-lg` buttons and icon chips, `rounded-full` pills. | `--radius` |
| Elevation | `shadow-card` at rest, `shadow-card-hover` on hover. Dark mode uses borders more than shadows. | `src/index.css` |
| Theme | Light / Dark / System. The inline script in `index.html` applies it before first paint. | `src/components/theme.tsx` |

## Components

- **Primitives:** shadcn/ui (Radix, accessible by default) in `src/components/ui/`. Add more with `npx shadcn@latest add <name>`.
- **App building blocks:** `src/components/page.tsx`: `PageHeader`, `Surface`, `StatCard`, `EmptyState`.
- **Icons:** lucide-react. Category icons go through the registry in `src/lib/categoryIcons.ts` (keeps the offline bundle small).
- **Toasts:** `import { toast } from 'sonner'`. Use them for results of actions ("142 transactions imported"), not for errors that need a decision.

## Motion

Tokens live in `src/lib/motion.ts`.

| Use | How | Duration |
|---|---|---|
| Page enter | Fade + 8px rise, no exit animation (it would delay navigation) | 250 ms |
| Lists and card grids | `<Stagger>` + `<StaggerItem>`, 50 ms between items | 400 ms each |
| Moving selection (nav, segmented controls) | `layoutId` + `SPRING` | ~450 ms spring |
| Money values | `<AnimatedMoney>` counts up | 900 ms |
| Clickable cards | `Surface interactive`: 2px lift + shadow | 200 ms |
| Press feedback | `whileTap={{ scale: 0.85–0.97 }}` | instant |

Rules:
- Animate only `opacity` and `transform` (cheap for the GPU). Never width, height or top.
- Ease-out for things entering. Springs only for things that move position.
- `MotionConfig reducedMotion="user"` + a CSS media query turn motion off when the OS asks for reduced motion. Don't bypass this.

## Accessibility

- Text contrast is at least 4.5:1 (WCAG AA) in both themes.
- Every interactive element shows a visible `focus-visible` ring.
- Touch targets are at least 44px on touch screens (`pointer-coarse:min-h-11`).
- Icons are `aria-hidden`; icon-only buttons get an `aria-label`.
- A "Skip to content" link is the first Tab stop.
- Animated numbers also render an `sr-only` final value for screen readers.
- Loading states use `Skeleton` shapes that match the final layout (no layout jump).

## Layout

- Desktop (≥768px): 240px sidebar, content up to `max-w-6xl`.
- Mobile: sticky blurred top bar + bottom tab bar, with safe-area padding for notched phones.
- Card grids: 1 column on phones, 2–4 on wider screens.
