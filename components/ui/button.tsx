import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

// Sistema de controles (WDC-188): un alto (--ctl: 44 táctil, 36 con puntero fino), radio 8, texto
// semibold, press a .98 y foco por dentro. Los botones de ícono los dimensiona quien los usa.
const buttonVariants = cva(
  "press group/button inline-flex shrink-0 items-center justify-center rounded-md border border-transparent bg-clip-padding text-body font-semibold whitespace-nowrap outline-none select-none disabled:pointer-events-none disabled:opacity-45 aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:brightness-110",
        outline:
          "border-border bg-card text-foreground hover:border-rule-strong aria-expanded:border-rule-strong",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-surface-3 aria-expanded:bg-surface-3",
        ghost:
          "text-ink-2 hover:bg-secondary hover:text-foreground aria-expanded:bg-secondary aria-expanded:text-foreground",
        destructive:
          "bg-destructive-soft text-destructive hover:brightness-95",
        link: "text-primary hover:bg-primary-soft",
      },
      size: {
        default:
          "h-(--ctl) gap-2 px-4 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
        xs: "h-7 gap-1 rounded-sm px-2.5 text-caption has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1.5 px-3 text-callout pointer-coarse:min-h-11 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        lg: "h-11 gap-2 px-5 has-data-[icon=inline-end]:pr-4 has-data-[icon=inline-start]:pl-4",
        icon: "size-(--ctl)",
        "icon-xs": "size-6 rounded-sm [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8 pointer-coarse:size-11",
        "icon-lg": "size-11",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
