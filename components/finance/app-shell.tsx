"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useTheme } from "next-themes"
import {
  Home,
  Sun,
  Moon,
  LogOut,
  UserRound,
  Repeat,
  Settings,
  ChevronsUpDown,
  Plus,
  Search,
} from "lucide-react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
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
  useSidebar,
} from "@/components/ui/sidebar"
import { TooltipProvider } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { haptic } from "@/lib/haptics"
import { InstallAppItem } from "@/components/pwa/install-app-item"
import { AddTransactionSheet } from "./add-transaction-sheet"
import { AccountModal } from "./account-modal"
import type {
  AccountDTO,
  CategoryDTO,
} from "@/arch/v1/application/finance-use-cases/finance-read"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

// Solo rutas que existen. Movimientos/Presupuestos viven como secciones del
// dashboard y Cuotas como sección de Recurrentes; cuando sean páginas propias, se agregan aquí.
export type NavKey =
  | "inicio"
  | "recurrentes"
  | "configuracion"
  | "perfil"

const NAV: {
  key: NavKey
  label: string
  Icon: typeof Home
  href: string
}[] = [
  { key: "inicio", label: "Inicio", Icon: Home, href: "/dashboard" },
  {
    key: "recurrentes",
    label: "Recurrentes",
    Icon: Repeat,
    href: "/recurring",
  },
  // Un solo nombre por sección: el mismo en la barra lateral, la inferior y el título.
  { key: "configuracion", label: "Ajustes", Icon: Settings, href: "/settings" },
  { key: "perfil", label: "Perfil", Icon: UserRound, href: "/profile" },
]

type AppShellProps = {
  user: { name: string; initial: string; email?: string }
  active?: NavKey
  onNavigate?: (key: NavKey) => void
  onSignOut?: () => void
  // Datos del "+" (centro de la barra inferior en móvil, "Movimiento" en el topbar): el acceso
  // rápido a registrar un movimiento a mano (gasto o ingreso, con el toggle ±), igual en toda la app.
  // Crear recurrentes/cuotas NO va aquí: eso va en la cabecera de su sección.
  quickAdd?: { accounts: AccountDTO[]; categories: CategoryDTO[] }
  onSearch?: () => void // si se pasa, muestra la lupa "Buscar" abajo en el sidebar
  title?: string
  actions?: React.ReactNode // topbar derecha: selector de mes u otros
  children: React.ReactNode
}

// Shell desktop-first de la app: sidebar shadcn colapsable (drawer en móvil), topbar con
// acciones, y el contenido en SidebarInset. El toggle de tema vive en el menú de usuario.
export function AppShell({
  user,
  active,
  onNavigate,
  onSignOut,
  quickAdd,
  onSearch,
  title,
  actions,
  children,
}: AppShellProps) {
  const [addOpen, setAddOpen] = React.useState(false)
  const [accountOpen, setAccountOpen] = React.useState(false)
  const canAdd = !!quickAdd

  // Atajos de escritorio: "/" o Ctrl/⌘+K abre la búsqueda y "n" el nuevo movimiento. No actúan
  // escribiendo en un campo ni con un diálogo abierto: ahí las teclas son del diálogo.
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null
      if (target?.closest("input, textarea, select, [contenteditable=true]"))
        return
      if (document.querySelector('[role="dialog"], [role="alertdialog"]'))
        return
      const key = e.key.toLowerCase()
      const mod = e.ctrlKey || e.metaKey
      if (onSearch && (key === "/" || (key === "k" && mod))) {
        e.preventDefault()
        onSearch()
      } else if (canAdd && key === "n" && !mod && !e.altKey) {
        e.preventDefault()
        setAddOpen(true)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onSearch, canAdd])

  return (
    <TooltipProvider delayDuration={0}>
      <SidebarProvider>
        <Sidebar collapsible="icon">
          <SidebarHeader>
            <div className="flex items-center gap-2 px-1 py-1">
              <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary font-heading font-bold text-primary-foreground">
                L
              </div>
              <span className="font-heading text-lg font-bold tracking-tight group-data-[collapsible=icon]:hidden">
                Luca Plan
              </span>
            </div>
          </SidebarHeader>

          <SidebarContent>
            <SidebarGroup>
              <NavMenu active={active} onNavigate={onNavigate} />
            </SidebarGroup>
          </SidebarContent>

          <SidebarFooter>
            <UserMenu user={user} onSignOut={onSignOut} />
          </SidebarFooter>
        </Sidebar>

        <SidebarInset className="min-w-0">
          {/* Topbar solo en escritorio; en móvil el selector de mes flota (sticky) centrado. */}
          <header className="pwa-safe-top sticky top-0 z-10 hidden min-h-16 shrink-0 items-center gap-2 border-b border-border/60 bg-background/80 px-4 backdrop-blur md:flex lg:px-6">
            <SidebarTrigger className="size-9" />
            {title && (
              <h1 className="font-heading text-lg font-bold tracking-tight">
                {title}
              </h1>
            )}
            {/* Escritorio: crear, buscar y después el selector de mes, en ese orden. Buscar y crear
                viven en el topbar, no flotando: tapaban la esquina de la columna derecha. */}
            <div className="ml-auto flex items-center gap-2">
              {quickAdd && (
                <Button
                  onClick={() => setAddOpen(true)}
                  title="Nuevo movimiento (N)"
                  className="h-9"
                >
                  <Plus className="size-4" />
                  Movimiento
                </Button>
              )}
              {onSearch && (
                <Button
                  onClick={onSearch}
                  size="icon"
                  variant="secondary"
                  aria-label="Buscar movimientos"
                  title="Buscar (/ o Ctrl K)"
                  className="size-9"
                >
                  <Search className="size-4" />
                </Button>
              )}
              {actions}
            </div>
          </header>
          {/* Móvil: botones flotando sin barra — buscar | (selector u otras acciones) | usuario.
              items-start: el "Hoy" cuelga debajo del selector sin descentrar lupa/avatar. Sin fondo:
              solo los hijos reciben toques; lo que queda entre ellos pasa al contenido de abajo. */}
          <div className="pwa-safe-top pointer-events-none sticky top-0 z-20 flex justify-center px-4 pt-3 pb-3 md:hidden">
            <div className="flex w-full items-start justify-between gap-2 *:pointer-events-auto">
              {/* Sin trigger del sidebar: en móvil el drawer solo repetía la barra inferior y el
                  menú de usuario. El hueco lo ocupa la lupa; sin ella, un espaciador del mismo
                  ancho que el avatar para que las acciones del centro no se descentren. */}
              {onSearch ? (
                <button
                  onClick={() => {
                    haptic("light")
                    onSearch()
                  }}
                  aria-label="Buscar movimientos"
                  className="grid size-10 shrink-0 place-items-center rounded-lg bg-secondary transition-colors hover:bg-accent"
                >
                  <Search className="size-4.5" />
                </button>
              ) : (
                <div className="invisible size-10 shrink-0" aria-hidden />
              )}
              {actions}
              <UserMenu
                user={user}
                onSignOut={onSignOut}
                trigger={
                  <button
                    className="grid size-10 place-items-center rounded-full"
                    aria-label="Perfil"
                    onClick={() => haptic("light")}
                  >
                    <Avatar className="size-10 rounded-full">
                      <AvatarFallback className="rounded-full bg-secondary text-sm font-medium text-foreground">
                        {user.initial}
                      </AvatarFallback>
                    </Avatar>
                  </button>
                }
              />
            </div>
          </div>
          {/* Aire inferior solo en móvil, por la barra de navegación fija. En escritorio no flota
              nada. */}
          <div className="min-w-0 flex-1 pb-[calc(5rem+env(safe-area-inset-bottom))] md:pb-0">
            {children}
          </div>
        </SidebarInset>

        {/* Móvil: barra inferior fija con los destinos a un toque y el "+" de registrar al centro. */}
        <BottomNav
          active={active}
          onNavigate={onNavigate}
          onAdd={quickAdd ? () => setAddOpen(true) : undefined}
        />

        {quickAdd && (
          <>
            {/* Van todas las cuentas: el sheet decide cuáles aceptan alta a mano y cuáles se leen
                de una foto de la cartola (las conectadas, tarjeta de crédito incluida). */}
            <AddTransactionSheet
              open={addOpen}
              onOpenChange={setAddOpen}
              accounts={quickAdd.accounts}
              categories={quickAdd.categories}
              onCreateAccount={() => {
                setAddOpen(false)
                setAccountOpen(true)
              }}
            />
            <AccountModal open={accountOpen} onOpenChange={setAccountOpen} />
          </>
        )}
      </SidebarProvider>
    </TooltipProvider>
  )
}

// Nav del sidebar: links a rutas reales. El item activo se deriva del pathname (el prop
// `active` solo lo fuerza, para mocks). En móvil cierra el drawer al navegar.
function NavMenu({
  active,
  onNavigate,
}: {
  active?: NavKey
  onNavigate?: (key: NavKey) => void
}) {
  const pathname = usePathname()
  const { isMobile, setOpenMobile } = useSidebar()
  const activeKey =
    active ??
    NAV.find((n) => pathname === n.href || pathname.startsWith(n.href + "/"))
      ?.key

  return (
    <SidebarMenu>
      {NAV.map(({ key, label, Icon, href }) => (
        <SidebarMenuItem key={key}>
          <SidebarMenuButton
            asChild
            isActive={activeKey === key}
            tooltip={label}
          >
            <Link
              href={href}
              onClick={() => {
                haptic("light")
                onNavigate?.(key)
                if (isMobile) setOpenMobile(false)
                if (pathname === href)
                  window.scrollTo({ top: 0, behavior: "smooth" })
              }}
            >
              <Icon />
              <span>{label}</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
      ))}
    </SidebarMenu>
  )
}

// Barra inferior de navegación (solo móvil): los mismos destinos del sidebar, al alcance del
// pulgar y con el actual siempre visible. Con `onAdd`, el "+" de registrar va al centro, entre
// las dos mitades; sin él, los destinos se reparten el ancho igual y nada queda descentrado.
function BottomNav({
  active,
  onNavigate,
  onAdd,
}: {
  active?: NavKey
  onNavigate?: (key: NavKey) => void
  onAdd?: () => void
}) {
  const pathname = usePathname()
  const activeKey =
    active ??
    NAV.find((n) => pathname === n.href || pathname.startsWith(n.href + "/"))
      ?.key

  return (
    <nav
      aria-label="Navegación principal"
      className="fixed inset-x-0 bottom-0 z-30 flex border-t border-border/60 bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      {NAV.map(({ key, label, Icon, href }, i) => {
        const isActive = activeKey === key
        const link = (
          <Link
            key={key}
            href={href}
            aria-current={isActive ? "page" : undefined}
            onClick={() => {
              haptic("light")
              onNavigate?.(key)
              if (pathname === href)
                window.scrollTo({ top: 0, behavior: "smooth" })
            }}
            className={cn(
              "flex min-w-0 flex-1 flex-col items-center gap-0.5 py-2 transition-colors",
              isActive ? "text-primary" : "text-muted-foreground"
            )}
          >
            <Icon className="size-5 shrink-0" />
            <span className="max-w-full truncate text-[10px] leading-none">
              {label}
            </span>
          </Link>
        )
        if (!onAdd || i !== Math.floor(NAV.length / 2)) return link
        return (
          <React.Fragment key={key}>
            <div className="flex flex-1 items-center justify-center">
              <Button
                onClick={() => {
                  haptic("medium")
                  onAdd()
                }}
                size="icon"
                aria-label="Registrar un movimiento"
                className="size-11 rounded-full shadow-md"
              >
                <Plus className="size-6" />
              </Button>
            </div>
            {link}
          </React.Fragment>
        )
      })}
    </nav>
  )
}

function UserMenu({
  user,
  onSignOut,
  trigger,
}: {
  user: AppShellProps["user"]
  onSignOut?: () => void
  trigger?: React.ReactNode // trigger alternativo (avatar de la bottom bar); default: botón del sidebar
}) {
  const { resolvedTheme, setTheme } = useTheme()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {trigger ?? (
          <SidebarMenuButton
            size="lg"
            className="data-[state=open]:bg-sidebar-accent"
          >
            <Avatar className="size-8 rounded-lg bg-primary">
              <AvatarFallback className="rounded-lg bg-primary text-primary-foreground">
                {user.initial}
              </AvatarFallback>
            </Avatar>
            <div className="grid flex-1 text-left leading-tight group-data-[collapsible=icon]:hidden">
              <span className="truncate text-sm font-medium">{user.name}</span>
              {user.email && (
                <span className="truncate text-xs text-muted-foreground">
                  {user.email}
                </span>
              )}
            </div>
            <ChevronsUpDown className="ml-auto size-4 group-data-[collapsible=icon]:hidden" />
          </SidebarMenuButton>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-56">
        <DropdownMenuLabel className="font-normal">
          <div className="grid leading-tight">
            <span className="truncate text-sm font-medium">{user.name}</span>
            {user.email && (
              <span className="truncate text-xs text-muted-foreground">
                {user.email}
              </span>
            )}
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/profile">
            <UserRound className="size-4" />
            Mi perfil
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault() // no cerrar el menú al alternar
            haptic("light")
            setTheme(resolvedTheme === "dark" ? "light" : "dark")
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
        {/* Solo aparece si hay vía de instalación y la app no corre ya instalada */}
        <InstallAppItem />
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={() => onSignOut?.()}>
          <LogOut className="size-4" />
          Cerrar sesión
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
