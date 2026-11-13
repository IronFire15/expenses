import { createBrowserRouter } from 'react-router'
import { Layout } from './components/Layout'

/**
 * Each page is its own chunk, downloaded the first time you open it (then cached offline by the
 * service worker). The router waits for the chunk before switching pages, so there's no blank flash.
 */
export const router = createBrowserRouter([
  {
    element: <Layout />,
    hydrateFallbackElement: <div className="min-h-dvh bg-background" />,
    children: [
      { index: true, lazy: () => import('./pages/DashboardPage').then((m) => ({ Component: m.DashboardPage })) },
      { path: 'transactions', lazy: () => import('./pages/transactions/TransactionsPage').then((m) => ({ Component: m.TransactionsPage })) },
      { path: 'budgets', lazy: () => import('./pages/budgets/BudgetsPage').then((m) => ({ Component: m.BudgetsPage })) },
      { path: 'budgets/recurring', lazy: () => import('./pages/budgets/RecurringPage').then((m) => ({ Component: m.RecurringPage })) },
      { path: 'import', lazy: () => import('./pages/import/ImportPage').then((m) => ({ Component: m.ImportPage })) },
      { path: 'categories/rules', lazy: () => import('./pages/categories/RulesPage').then((m) => ({ Component: m.RulesPage })) },
      { path: 'categories', lazy: () => import('./pages/categories/CategoriesPage').then((m) => ({ Component: m.CategoriesPage })) },
      { path: 'settings', lazy: () => import('./pages/settings/SettingsPage').then((m) => ({ Component: m.SettingsPage })) },
      { path: '*', lazy: () => import('./pages/NotFoundPage').then((m) => ({ Component: m.NotFoundPage })) },
    ],
  },
])
