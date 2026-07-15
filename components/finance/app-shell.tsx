"use client";

import * as React from "react";
import { useTheme } from "next-themes";
import { Home, Sun, Moon, LogOut, UserRound, ChevronsUpDown, Plus, Search } from "lucide-react";
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
import { haptic } from "@/lib/haptics";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// Solo rutas que existen. Movimientos/Presupuestos viven como secciones del
// dashboard; cuando sean páginas propias, se agregan aquí.
export type NavKey = "inicio";

const NAV: { key: NavKey; label: string; Icon: typeof Home }[] = [
  { key: "inicio", label: "Inicio", Icon: Home },
];

type AppShellProps = {
  user: { name: string; initial: string; email?: string };
  active?: NavKey;
  onNavigate?: (key: NavKey) => void;
  onSignOut?: () => void;
  onAdd?: () => void; // si se pasa, muestra el FAB "agregar" flotante abajo-derecha
  onSearch?: () => void; // si se pasa, muestra la lupa "Buscar" abajo en el sidebar
  title?: string;
  actions?: React.ReactNode; // topbar derecha: selector de mes u otros
  children: React.ReactNode;
};

// Shell desktop-first de la app: sidebar shadcn colapsable (drawer en móvil), topbar con
// acciones, y el contenido en SidebarInset. El toggle de tema vive en el menú de usuario.
export function AppShell({ user, active = "inicio", onNavigate, onSignOut, onAdd, onSearch, title, actions, children }: AppShellProps) {
  return (
    <TooltipProvider delayDuration={0}>
      <SidebarProvider>
        <Sidebar collapsible="icon">
          <SidebarHeader>
            <div className="flex items-center gap-2 px-1 py-1">
              <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary font-heading font-bold text-primary-foreground">L</div>
              <span className="font-heading text-lg font-bold tracking-tight group-data-[collapsible=icon]:hidden">Luca Plan</span>
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

        <SidebarInset className="min-w-0">
          {/* Topbar solo en escritorio; en móvil el selector de mes flota (sticky) centrado. */}
          <header className="sticky top-0 z-10 hidden h-16 shrink-0 items-center gap-2 border-b border-border/60 bg-background/80 px-4 backdrop-blur md:flex lg:px-6">
            <SidebarTrigger className="size-9" />
            {title && <h1 className="font-heading text-lg font-bold tracking-tight">{title}</h1>}
            <div className="ml-auto flex items-center gap-2">{actions}</div>
          </header>
          {/* Móvil: fila flotante a la altura del selector de mes — lupa | selector | usuario.
              items-start: el "Hoy" cuelga debajo del selector sin descentrar lupa/avatar. */}
          {actions && (
            <div className="pointer-events-none sticky top-0 z-20 flex justify-center px-4 pt-3 md:hidden">
              <div className="pointer-events-auto flex w-full items-start justify-between gap-2 drop-shadow-md">
                {onSearch && (
                  <button
                    onClick={() => {
                      haptic("light");
                      onSearch();
                    }}
                    aria-label="Buscar movimientos"
                    className="grid size-10 place-items-center rounded-full bg-secondary transition-colors hover:bg-accent"
                  >
                    <Search className="size-4.5" />
                  </button>
                )}
                {actions}
                <UserMenu
                  user={user}
                  onSignOut={onSignOut}
                  trigger={
                    <button className="grid size-10 place-items-center rounded-full" aria-label="Perfil" onClick={() => haptic("light")}>
                      <Avatar className="size-10 rounded-full">
                        <AvatarFallback className="rounded-full bg-secondary text-sm font-medium text-foreground">{user.initial}</AvatarFallback>
                      </Avatar>
                    </button>
                  }
                />
              </div>
            </div>
          )}
          {/* pb móvil: aire para que el FAB no tape el último movimiento */}
          <div className="min-w-0 flex-1 pb-20 md:pb-0">{children}</div>
        </SidebarInset>

        {/* FABs flotantes abajo-derecha (en móvil solo el crear; la lupa vive arriba) */}
        {(onAdd || onSearch) && (
          <div className="fixed right-5 bottom-[max(1.25rem,env(safe-area-inset-bottom))] z-30 flex items-center gap-3 lg:right-8 lg:bottom-8">
            {onSearch && (
              <Button
                onClick={() => {
                  haptic("light");
                  onSearch();
                }}
                size="icon"
                variant="secondary"
                aria-label="Buscar movimientos"
                className="hidden size-14 rounded-full shadow-lg md:inline-flex"
              >
                <Search className="size-6" />
              </Button>
            )}
            {onAdd && (
              <Button
                onClick={() => {
                  haptic("medium");
                  onAdd();
                }}
                size="icon"
                aria-label="Agregar movimiento"
                className="size-14 rounded-full shadow-lg"
              >
                <Plus className="size-6" />
              </Button>
            )}
          </div>
        )}

      </SidebarProvider>
    </TooltipProvider>
  );
}

function UserMenu({
  user,
  onSignOut,
  trigger,
}: {
  user: AppShellProps["user"];
  onSignOut?: () => void;
  trigger?: React.ReactNode; // trigger alternativo (avatar de la bottom bar); default: botón del sidebar
}) {
  const { resolvedTheme, setTheme } = useTheme();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {trigger ?? (
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
        )}
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
          {/* icono/texto por CSS anclado al <html> (next-themes): el DropdownMenuContent lleva
              la clase `dark` fija (glass oscuro del design system), así que `dark:` mentiría aquí;
              [html.dark_&] mira solo el tema real. Sin mismatch de hidratación ni useEffect. */}
          <Sun className="hidden size-4 [html.dark_&]:block" />
          <Moon className="size-4 [html.dark_&]:hidden" />
          <span className="hidden [html.dark_&]:inline">Tema claro</span>
          <span className="[html.dark_&]:hidden">Tema oscuro</span>
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
