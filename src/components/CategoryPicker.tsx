import { Check, RotateCcw } from 'lucide-react'
import { createElement, useState, type ReactNode } from 'react'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import type { Category, CategoryType } from '@/db/types'
import { categoryIcon } from '@/lib/categoryIcons'
import { cn } from '@/lib/utils'

const GROUPS: { type: CategoryType; label: string }[] = [
  { type: 'expense', label: 'Expenses' },
  { type: 'income', label: 'Income' },
  { type: 'transfer', label: 'Not spending' },
]

/** Colored icon chip for a category; dashed outline when uncategorized. */
export function CategoryIcon({ category, size = 'md' }: { category?: Category; size?: 'sm' | 'md' }) {
  // createElement: the icon is looked up from a static registry, not created during render.
  const icon = createElement(categoryIcon(category?.icon), { 'aria-hidden': true })
  const box = size === 'sm' ? 'size-7 rounded-md [&_svg]:size-3.5' : 'size-9 rounded-lg [&_svg]:size-4.5'
  if (!category) {
    return (
      <span className={cn('grid shrink-0 place-items-center border border-dashed border-muted-foreground/40 text-muted-foreground', box)}>
        {icon}
      </span>
    )
  }
  return (
    <span className={cn('grid shrink-0 place-items-center', box)} style={{ backgroundColor: `${category.color}22`, color: category.color }}>
      {icon}
    </span>
  )
}

/**
 * Searchable category menu. `onReset` adds "Use rules again", shown when the current choice was made by hand.
 */
export function CategoryPicker({
  categories,
  value,
  onChange,
  onReset,
  children,
  align = 'start',
}: {
  categories: Category[]
  value?: string
  onChange: (categoryId: string) => void
  onReset?: () => void
  children: ReactNode
  align?: 'start' | 'end'
}) {
  const [open, setOpen] = useState(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="w-64 p-0" align={align}>
        <Command>
          <CommandInput placeholder="Search categories…" />
          <CommandList className="max-h-80">
            <CommandEmpty>No category found.</CommandEmpty>
            {GROUPS.map((g) => {
              const items = categories.filter((c) => c.type === g.type)
              if (!items.length) return null
              return (
                <CommandGroup key={g.type} heading={g.label}>
                  {items.map((c) => (
                    <CommandItem
                      key={c.id}
                      value={`${c.name} ${c.id}`}
                      onSelect={() => {
                        onChange(c.id)
                        setOpen(false)
                      }}
                    >
                      <CategoryIcon category={c} size="sm" />
                      <span className="flex-1 truncate">{c.name}</span>
                      {value === c.id && <Check className="text-primary" aria-hidden />}
                    </CommandItem>
                  ))}
                </CommandGroup>
              )
            })}
            {onReset && (
              <>
                <CommandSeparator />
                <CommandGroup>
                  <CommandItem
                    value="use rules automatic reset"
                    onSelect={() => {
                      onReset()
                      setOpen(false)
                    }}
                  >
                    <RotateCcw aria-hidden /> Use rules again
                  </CommandItem>
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
