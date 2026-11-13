import { Compass, LayoutDashboard } from 'lucide-react'
import { Link } from 'react-router'
import { EmptyState, PageHeader } from '@/components/page'
import { Button } from '@/components/ui/button'

export function NotFoundPage() {
  return (
    <>
      <PageHeader title="Page not found" />
      <EmptyState
        icon={Compass}
        title="This page doesn’t exist"
        actions={
          <Button asChild size="lg">
            <Link to="/">
              <LayoutDashboard aria-hidden /> Go to Dashboard
            </Link>
          </Button>
        }
      >
        The link may be old, or there was a typo in the address.
      </EmptyState>
    </>
  )
}
