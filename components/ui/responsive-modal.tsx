"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";

// Superficie contextual adaptativa: diálogo centrado en escritorio, drawer inferior estilo iOS
// en móvil (vaul: full-height, arrastrable, con el fondo escalado vía data-vaul-drawer-wrapper
// en el layout). Mismo contenido y comportamiento; solo cambia el envoltorio (useIsMobile, 768px).
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
      <Drawer open={open} onOpenChange={onOpenChange} shouldScaleBackground setBackgroundColorOnScale={false}>
        <DrawerContent
          className={cn("h-[96dvh] data-[vaul-drawer-direction=bottom]:max-h-[96dvh]", className)}
        >
          <DrawerHeader className={headerClassName}>
            <DrawerTitle>{title}</DrawerTitle>
          </DrawerHeader>
          <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">{children}</div>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn("max-h-[90dvh] gap-0 overflow-x-hidden overflow-y-auto rounded-3xl p-0 sm:max-w-lg [&>*]:min-w-0", className)}>
        <DialogHeader className={cn("p-6", headerClassName)}>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}
