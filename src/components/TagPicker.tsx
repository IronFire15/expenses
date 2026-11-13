import { Plus, Tag } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cleanTag } from '@/transactions/tags'

/** Pick an existing tag or type a new one. Tags already on the item are left out. */
export function TagPicker({
  tags,
  exclude = [],
  onPick,
  children,
  align = 'start',
}: {
  tags: string[]
  exclude?: string[]
  onPick: (tag: string) => void
  children: ReactNode
  align?: 'start' | 'end'
}) {
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const clean = cleanTag(typed)
  const available = tags.filter((t) => !exclude.includes(t))
  const exists = tags.some((t) => t.localeCompare(clean, undefined, { sensitivity: 'base' }) === 0)

  const pick = (tag: string) => {
    onPick(tag)
    setOpen(false)
    setTyped('')
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="w-64 p-0" align={align}>
        <Command>
          <CommandInput placeholder="Find or create a tag…" value={typed} onValueChange={setTyped} maxLength={40} />
          <CommandList className="max-h-72">
            {!clean && !available.length && <CommandEmpty>Type a name, e.g. “Vacation 2026”.</CommandEmpty>}
            {clean && !exists && (
              <CommandGroup>
                <CommandItem value={`create ${clean}`} onSelect={() => pick(clean)}>
                  <Plus aria-hidden /> Create “{clean}”
                </CommandItem>
              </CommandGroup>
            )}
            {available.length > 0 && (
              <CommandGroup heading="Tags">
                {available.map((t) => (
                  <CommandItem key={t} value={t} onSelect={() => pick(t)}>
                    <Tag aria-hidden /> <span className="truncate">{t}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

/** Small tag pill. With `onRemove`, shows a remove button. */
export function TagPill({ tag, onRemove, className }: { tag: string; onRemove?: () => void; className?: string }) {
  return (
    <span className={`inline-flex max-w-full items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground ${className ?? ''}`}>
      <Tag className="size-3 shrink-0" aria-hidden />
      <span className="truncate">{tag}</span>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove tag ${tag}`}
          className="-mr-1 grid size-4 place-items-center rounded-full outline-none hover:bg-foreground/10 focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:size-6"
        >
          ×
        </button>
      )}
    </span>
  )
}
