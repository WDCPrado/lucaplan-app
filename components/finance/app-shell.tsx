"use client";

import * as React from "react";
import { useTheme } from "next-themes";
import { Home, ArrowLeftRight, PieChart, Sun, Moon, LogOut, UserRound, ChevronsUpDown, Plus } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type NavKey = "inicio" | "movimientos" | "presupuestos";

const NAV: { key: NavKey; label: string; Icon: typeof Home }[] = [
  { key: "inicio", label: "Inicio", Icon: Home },
  { key: "movimientos", label: "Movimientos", Icon: ArrowLeftRight },
  { key: "presupuestos", label: "Presupuestos", Icon: PieChart },
];

type AppShellProps = {
  user: { name: string; initial: string; email?: string };
  active?: NavKey;
  onNavigate?: (key: NavKey) => void;
  onSignOut?: () => void;
  onAdd?: () => void; // si se pasa, muestra el FAB "agregar" flotante abajo-derecha
  title?: string;
  actions?: React.ReactNode; // topbar derecha: selector de mes u otros
  children: React.ReactNode;
};

// Shell desktop-first de la app: sidebar shadcn colapsable (drawer en móvil), topbar con
// acciones, y el contenido en SidebarInset. El toggle de tema vive en el menú de usuario.
export function AppShell({ user, active = "inicio", onNavigate, onSignOut, onAdd, title, actions, children }: AppShellProps) {
  return (
    <TooltipProvider delayDuration={0}>
      <SidebarProvider>
        <Sidebar collapsible="icon">
          <SidebarHeader>
            <div className="flex items-center gap-2 px-1 py-1">
              <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary font-heading font-bold text-primary-foreground">L</div>
              <span className="font-heading text-lg font-bold tracking-tight group-data-[collapsible=icon]:hidden">LucaPlan</span>
            </div>
          </SidebarHeader>

          <SidebarContent>
            <SidebarGroup>
              <SidebarMenu>
                {NAV.map(({ key, label, Icon }) => (
                  <SidebarMenuItem key={key}>
                    <SidebarMenuButton isActive={active === key} tooltip={label} onClick={() => onNavigate?.(key)}>
                      <Icon />
                      <span>{label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroup>
          </SidebarContent>

          <SidebarFooter>
            <UserMenu user={user} onSignOut={onSignOut} />
          </SidebarFooter>
        </Sidebar>

        <SidebarInset>
          <header className="sticky top-0 z-10 flex h-16 shrink-0 items-center gap-2 border-b border-border/60 bg-background/80 px-4 backdrop-blur lg:px-6">
            <SidebarTrigger className="size-9" />
            {title && <h1 className="font-heading text-lg font-bold tracking-tight">{title}</h1>}
            <div className="ml-auto flex items-center gap-2">{actions}</div>
          </header>
          <div className="flex-1">{children}</div>
        </SidebarInset>

        {onAdd && (
          <Button
            onClick={onAdd}
            size="icon"
            aria-label="Agregar movimiento"
            className="fixed right-5 bottom-5 z-30 size-14 rounded-full shadow-lg lg:right-8 lg:bottom-8"
          >
            <Plus className="size-6" />
          </Button>
        )}
      </SidebarProvider>
    </TooltipProvider>
  );
}

function UserMenu({ user, onSignOut }: { user: AppShellProps["user"]; onSignOut?: () => void }) {
  const { resolvedTheme, setTheme } = useTheme();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <SidebarMenuButton size="lg" className="data-[state=open]:bg-sidebar-accent">
          <Avatar className="size-8 rounded-lg bg-primary">
            <AvatarFallback className="rounded-lg bg-primary text-primary-foreground">{user.initial}</AvatarFallback>
          </Avatar>
          <div className="grid flex-1 text-left leading-tight group-data-[collapsible=icon]:hidden">
            <span className="truncate text-sm font-medium">{user.name}</span>
            {user.email && <span className="truncate text-xs text-muted-foreground">{user.email}</span>}
          </div>
          <ChevronsUpDown className="ml-auto size-4 group-data-[collapsible=icon]:hidden" />
        </SidebarMenuButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-56">
        <DropdownMenuLabel className="font-normal">
          <div className="grid leading-tight">
            <span className="truncate text-sm font-medium">{user.name}</span>
            {user.email && <span className="truncate text-xs text-muted-foreground">{user.email}</span>}
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem>
          <UserRound className="size-4" />
          Mi perfil
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault(); // no cerrar el menú al alternar
            setTheme(resolvedTheme === "dark" ? "light" : "dark");
          }}
        >
          {/* icono/texto por CSS según la clase .dark: sin mismatch de hidratación ni useEffect */}
          <Sun className="hidden size-4 dark:block" />
          <Moon className="size-4 dark:hidden" />
          <span className="hidden dark:inline">Tema claro</span>
          <span className="dark:hidden">Tema oscuro</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={() => onSignOut?.()}>
          <LogOut className="size-4" />
          Cerrar sesión
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
