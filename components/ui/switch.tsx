"use client"

import * as React from "react"
import { Switch as SwitchPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function Switch({
  className,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        // 44×26 con perilla de 20; el área táctil sube a 44 px con el ::after.
        "peer relative inline-flex h-[1.625rem] w-11 shrink-0 items-center rounded-full transition-colors duration-150 outline-none after:absolute after:-inset-x-1 after:-inset-y-2 motion-reduce:transition-none",
        "data-[state=checked]:bg-primary data-[state=unchecked]:bg-surface-3",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "pointer-events-none block size-5 rounded-full bg-card shadow-[0_1px_2px_rgb(0_0_0/0.2)]",
          "transition-transform duration-200 ease-(--ease-out) motion-reduce:transition-none",
          "data-[state=checked]:translate-x-[1.3125rem] data-[state=unchecked]:translate-x-[0.1875rem]"
        )}
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
