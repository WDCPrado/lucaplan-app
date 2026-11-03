"use client"

import { useRef, type ComponentProps } from "react"
import { CircleX, Search } from "lucide-react"
import { Input } from "./input"
import { cn } from "@/lib/utils"

export function SearchInput({
  value,
  onValueChange,
  className,
  disabled,
  ...props
}: Omit<
  ComponentProps<typeof Input>,
  "value" | "defaultValue" | "onChange" | "ref"
> & {
  value: string
  onValueChange: (value: string) => void
}) {
  const input = useRef<HTMLInputElement>(null)
  return (
    <div className="relative">
      <Search
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-3 size-4.5 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        {...props}
        ref={input}
        value={value}
        disabled={disabled}
        onChange={(event) => onValueChange(event.target.value)}
        inputMode="search"
        className={cn("h-11 rounded-full pr-11 pl-10 text-body md:text-body", className)}
      />
      {value && (
        <button
          type="button"
          disabled={disabled}
          aria-label="Limpiar búsqueda"
          className="press absolute top-1/2 right-0 grid size-11 -translate-y-1/2 place-items-center rounded-full focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50"
          onClick={() => {
            onValueChange("")
            input.current?.focus()
          }}
        >
          {/* `xmark.circle.fill` de iOS: círculo gris relleno con la X calada en el color del campo. */}
          <CircleX
            aria-hidden
            className="size-4.5 fill-muted-foreground/70 text-(--sheet-cell)"
            strokeWidth={2.5}
          />
        </button>
      )}
    </div>
  )
}
