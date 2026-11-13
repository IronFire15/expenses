import { FileUp, ShieldCheck } from 'lucide-react'
import { motion } from 'motion/react'
import { useRef, useState, type DragEvent } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { SUPPORTED_BANKS } from '@/import/parsers'
import { cn } from '@/lib/utils'

export function Dropzone({ onFiles, compact = false }: { onFiles: (files: File[]) => void; compact?: boolean }) {
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const depth = useRef(0) // dragenter/leave fire for every child element

  const pick = (list: FileList | null) => {
    const files = list ? [...list] : []
    if (files.length) onFiles(files)
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    depth.current = 0
    setOver(false)
    pick(e.dataTransfer.files)
  }

  return (
    <motion.div
      onDragEnter={(e) => {
        e.preventDefault()
        depth.current++
        setOver(true)
      }}
      onDragLeave={() => {
        depth.current--
        if (depth.current <= 0) setOver(false)
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
      onClick={() => input.current?.click()}
      animate={{ scale: over ? 1.01 : 1 }}
      transition={{ type: 'spring', bounce: 0.2, duration: 0.3 }}
      className={cn(
        'group relative flex cursor-pointer flex-col items-center rounded-2xl border-2 border-dashed text-center transition-colors',
        compact ? 'px-6 py-6' : 'px-6 py-14 md:py-20',
        over ? 'border-primary bg-brand-soft' : 'border-border bg-card hover:border-primary/50 hover:bg-brand-soft/40',
      )}
    >
      <input
        ref={input}
        type="file"
        accept=".pdf,application/pdf"
        multiple
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => {
          pick(e.target.files)
          e.target.value = '' // allow picking the same file again
        }}
      />
      {!compact && (
        <motion.span
          className="mb-5 grid size-14 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/25"
          animate={over ? { y: -6, rotate: -4 } : { y: [0, -4, 0], rotate: 0 }}
          transition={over ? { type: 'spring', bounce: 0.4 } : { duration: 3, repeat: Infinity, ease: 'easeInOut' }}
        >
          <FileUp className="size-7" aria-hidden />
        </motion.span>
      )}
      <p className={cn('font-semibold tracking-tight', compact ? 'text-sm' : 'text-lg')}>
        {over ? 'Drop to add' : compact ? 'Add more statements' : 'Drop your bank statements here'}
      </p>
      {!compact && <p className="mt-1 text-sm text-muted-foreground">Select several months at once. Nothing is saved until you confirm.</p>}
      <Button
        type="button"
        variant={compact ? 'outline' : 'default'}
        size={compact ? 'default' : 'lg'}
        className="mt-4"
        onClick={(e) => {
          e.stopPropagation()
          input.current?.click()
        }}
      >
        Browse files
      </Button>
      {!compact && (
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2 text-xs text-muted-foreground">
          <span>Supported:</span>
          {SUPPORTED_BANKS.map((b) => (
            <Badge key={b} variant="secondary">
              {b} · PDF
            </Badge>
          ))}
          <span className="flex items-center gap-1">
            <ShieldCheck className="size-3.5 text-positive" aria-hidden /> Files never leave this device
          </span>
        </div>
      )}
    </motion.div>
  )
}
