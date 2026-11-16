import { AppWindow, Cloud, DatabaseBackup, HardDrive, Info, Palette, Trash2, UserRound, type LucideIcon } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { Stagger, StaggerItem } from '@/components/motion'
import { PageHeader, Surface } from '@/components/page'
import { ThemeSwitcher } from '@/components/theme'
import { DEFAULT_CURRENCY, DEFAULT_LOCALE } from '@/lib/money'
import { cn } from '@/lib/utils'
import { AccountCard } from './AccountCard'
import { BackupCard } from './BackupCard'
import { ClearDataCard } from './ClearDataCard'
import { InstallCard } from './InstallCard'
import { SyncCard } from './SyncCard'
import { VersionCard } from './VersionCard'

function useStorageEstimate() {
  const [usage, setUsage] = useState<string>()
  useEffect(() => {
    navigator.storage?.estimate().then((e) => setUsage(`${Math.max(1, Math.round((e.usage ?? 0) / 1024))} KB`))
  }, [])
  return usage
}

function Section({
  icon: Icon,
  title,
  description,
  tone,
  children,
}: {
  icon: LucideIcon
  title: string
  description: string
  tone?: 'danger'
  children: ReactNode
}) {
  return (
    <Surface className={cn('h-full p-5', tone === 'danger' && 'border-destructive/30')}>
      <div className="mb-4 flex items-start gap-3">
        <span className={cn('grid size-9 shrink-0 place-items-center rounded-lg', tone === 'danger' ? 'bg-destructive/10 text-destructive' : 'bg-brand-soft text-primary')}>
          <Icon className="size-4.5" aria-hidden />
        </span>
        <div>
          <h2 className="font-semibold tracking-tight">{title}</h2>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
      {children}
    </Surface>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-t py-3 text-sm first:border-t-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  )
}

export function SettingsPage() {
  const usage = useStorageEstimate()

  return (
    <>
      <PageHeader title="Settings" />
      <Stagger className="grid gap-4 lg:grid-cols-2">
        <StaggerItem className="min-w-0 lg:col-span-2">
          <Section icon={UserRound} title="Account" description="Your Google account: signs you in and holds the sync file.">
            <AccountCard />
          </Section>
        </StaggerItem>
        <StaggerItem className="min-w-0 lg:col-span-2">
          <Section icon={Cloud} title="Google Drive sync" description="Same data on your phone and computers.">
            <SyncCard />
          </Section>
        </StaggerItem>
        <StaggerItem className="min-w-0">
          <Section icon={DatabaseBackup} title="Backup and export" description="Download or restore everything, or export to a spreadsheet.">
            <BackupCard />
          </Section>
        </StaggerItem>
        <StaggerItem className="min-w-0">
          <Section icon={Palette} title="Appearance" description="Follows your device by default.">
            <ThemeSwitcher id="settings-theme" />
          </Section>
        </StaggerItem>
        <StaggerItem className="min-w-0">
          <Section icon={AppWindow} title="Install the app" description="On your phone, tablet or computer.">
            <InstallCard />
          </Section>
        </StaggerItem>
        <StaggerItem className="min-w-0">
          <Section icon={HardDrive} title="This device" description="Everything is stored locally and works offline.">
            <dl>
              <Row label="Currency">{DEFAULT_CURRENCY}</Row>
              <Row label="Number format">{DEFAULT_LOCALE}</Row>
              <Row label="Storage used">{usage ?? '…'}</Row>
            </dl>
          </Section>
        </StaggerItem>
        <StaggerItem className="min-w-0 lg:col-span-2">
          <Section icon={Info} title="App version" description="Which version this device is running.">
            <VersionCard />
          </Section>
        </StaggerItem>
        <StaggerItem className="min-w-0 lg:col-span-2">
          <Section icon={Trash2} title="Clear all data" description="Start over from scratch." tone="danger">
            <ClearDataCard />
          </Section>
        </StaggerItem>
      </Stagger>
    </>
  )
}
