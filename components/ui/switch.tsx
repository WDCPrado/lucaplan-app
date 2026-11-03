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
        // Toggle de iOS: pista de 51×31 en cápsula; el área táctil sube a 47 px con el ::after.
        "peer relative inline-flex h-[1.9375rem] w-[3.1875rem] shrink-0 items-center rounded-full transition-colors duration-200 outline-none after:absolute after:-inset-x-1 after:-inset-y-2 motion-reduce:transition-none",
        "data-[state=checked]:bg-(--switch-on) data-[state=unchecked]:bg-(--glass-control)",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "pointer-events-none block size-[1.6875rem] rounded-full bg-(--knob) shadow-(--knob-shadow)",
          // Spring corto, como la perilla de iOS; sin movimiento con movimiento reducido.
          "transition-transform duration-500 ease-(--ease-spring) motion-reduce:transition-none",
          // 51 px de pista − 27 de perilla − 2 de margen = 22 px. Simétrico en ambos extremos.
          "data-[state=checked]:translate-x-[1.375rem] data-[state=unchecked]:translate-x-0.5"
        )}
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
