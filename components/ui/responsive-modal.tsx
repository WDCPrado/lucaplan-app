"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

// Superficie contextual adaptativa: diálogo centrado en escritorio, sheet inferior en móvil.
// Mismo contenido y comportamiento; solo cambia el envoltorio según el viewport (useIsMobile,
// breakpoint 768px). Drop-in para reemplazar el patrón <Sheet><SheetContent side="bottom">.
export function ResponsiveModal({
  open,
  onOpenChange,
  title,
  children,
  className,
  headerClassName,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  children: React.ReactNode;
  className?: string;
  headerClassName?: string;
}) {
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" className={cn("max-h-[92dvh] overflow-x-hidden overflow-y-auto rounded-t-3xl", className)}>
          <SheetHeader className={headerClassName}>
            <SheetTitle>{title}</SheetTitle>
          </SheetHeader>
          {children}
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn("max-h-[90dvh] gap-0 overflow-x-hidden overflow-y-auto rounded-3xl p-0 sm:max-w-lg", className)}>
        <DialogHeader className={cn("p-6", headerClassName)}>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}
