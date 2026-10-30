"use client"

import * as React from "react"
import { createPortal } from "react-dom"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
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
  ListFilter,
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

// Solo rutas que existen. Presupuestos vive como sección del dashboard y Cuotas como sección de
// Recurrentes; cuando sean páginas propias, se agregan aquí.
export type NavKey =
  | "inicio"
  | "recurrentes"
  | "movimientos"
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
  {
    key: "movimientos",
    label: "Movimientos",
    Icon: ListFilter,
    href: "/movements",
  },
  // Un solo nombre por sección: el mismo en la barra lateral, la inferior y el título.
  { key: "configuracion", label: "Ajustes", Icon: Settings, href: "/settings" },
  { key: "perfil", label: "Perfil", Icon: UserRound, href: "/profile" },
]

// La barra inferior no lleva Perfil: ya está en el avatar.
const BOTTOM_NAV = NAV.filter((n) => n.key !== "perfil")

function navKeyOf(pathname: string): NavKey | undefined {
  return NAV.find(
    (n) => pathname === n.href || pathname.startsWith(n.href + "/")
  )?.key
}

function subscribeToScroll(onChange: () => void) {
  window.addEventListener("scroll", onChange, { passive: true })
  return () => window.removeEventListener("scroll", onChange)
}

type QuickAdd = { accounts: AccountDTO[]; categories: CategoryDTO[] }

// Lo que el AppFrame le presta al AppShell: "abrir nuevo movimiento" y el hueco de la barra inferior
// donde la vista pone su búsqueda. Con él, el AppShell no monta su propia barra inferior ni su
// sheet: usa los del marco, que viven una sola vez para toda la app.
type Frame = { openAdd: () => void; searchSlot: HTMLElement | null }
const FrameContext = React.createContext<Frame | null>(null)

// Marco de las pantallas con sesión (layout de app/(app)): la barra inferior móvil y el sheet de
// nuevo movimiento quedan montados entre rutas, sin recargarse en cada navegación. El "+" de
// Movimientos, el "Movimiento" del topbar y la tecla "n" del AppShell abren este mismo sheet.
export function AppFrame({
  quickAdd,
  children,
}: {
  quickAdd: QuickAdd
  children: React.ReactNode
}) {
  const [addOpen, setAddOpen] = React.useState(false)
  const openAdd = React.useCallback(() => setAddOpen(true), [])
  // La búsqueda es de cada vista (su handler vive en ella): la vista la monta en este hueco con un
  // portal, junto a la cápsula de pestañas. Sin búsqueda, el hueco queda vacío y la cápsula ocupa
  // el ancho.
  const [searchSlot, setSearchSlot] = React.useState<HTMLElement | null>(null)
  const frame = React.useMemo(
    () => ({ openAdd, searchSlot }),
    [openAdd, searchSlot]
  )
  return (
    <FrameContext.Provider value={frame}>
      {children}
      <BottomNav slotRef={setSearchSlot} />
      <QuickAddSheet
        open={addOpen}
        onOpenChange={setAddOpen}
        quickAdd={quickAdd}
      />
    </FrameContext.Provider>
  )
}

// Van todas las cuentas: el sheet decide cuáles aceptan alta a mano y cuáles se leen de una foto
// de la cartola (las conectadas, tarjeta de crédito incluida).
function QuickAddSheet({
  open,
  onOpenChange,
  quickAdd,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  quickAdd: QuickAdd
}) {
  const [accountOpen, setAccountOpen] = React.useState(false)
  return (
    <AddTransactionSheet
      open={open}
      onOpenChange={onOpenChange}
      accounts={quickAdd.accounts}
      categories={quickAdd.categories}
      onCreateAccount={() => setAccountOpen(true)}
    >
      <AccountModal open={accountOpen} onOpenChange={setAccountOpen} />
    </AddTransactionSheet>
  )
}

type AppShellProps = {
  user: { name: string; initial: string; email?: string }
  active?: NavKey
  onNavigate?: (key: NavKey) => void
  onSignOut?: () => void
  // Datos de "nuevo movimiento" (el "+" de Movimientos en móvil, "Movimiento" en el topbar): el
  // acceso rápido a registrar un movimiento a mano (gasto o ingreso, con el toggle ±). Crear
  // recurrentes/cuotas NO va aquí: eso va en la cabecera de su sección. Dentro de un AppFrame
  // sobra: el sheet es el del marco. Sin marco (los mocks de /design) lo monta el shell.
  quickAdd?: QuickAdd
  // Móvil: muestra el "+" de nuevo movimiento arriba a la derecha. Solo la vista Movimientos.
  showAdd?: boolean
  onSearch?: () => void // si se pasa, muestra la búsqueda (barra inferior en móvil, topbar en escritorio)
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
  showAdd,
  onSearch,
  title,
  actions,
  children,
}: AppShellProps) {
  const hasScrolled = React.useSyncExternalStore(
    subscribeToScroll,
    () => window.scrollY > 0,
    () => false
  )
  const frame = React.useContext(FrameContext)
  const [addOpen, setAddOpen] = React.useState(false)
  const localOpenAdd = React.useCallback(() => setAddOpen(true), [])
  const openAdd = frame?.openAdd ?? (quickAdd ? localOpenAdd : undefined)

  // Móvil: la búsqueda va suelta a la derecha de la cápsula de pestañas (iOS 26, como Música o
  // Fotos), del alto de la cápsula. Abre lo mismo que la búsqueda del topbar de escritorio.
  const searchButton = onSearch && (
    <button
      type="button"
      onClick={() => {
        haptic("light")
        onSearch()
      }}
      aria-label="Buscar movimientos"
      className="press liquid-glass pointer-events-auto grid size-16 shrink-0 place-items-center rounded-full"
    >
      <Search className="size-6" />
    </button>
  )

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
      } else if (openAdd && key === "n" && !mod && !e.altKey) {
        e.preventDefault()
        openAdd()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onSearch, openAdd])

  return (
    <TooltipProvider delayDuration={0}>
      <SidebarProvider>
        {/* Escritorio: sidebar flotante en vidrio, separado del borde (macOS 26); el vidrio lo pone
            globals.css sobre [data-variant=floating]. En móvil sigue siendo el drawer. */}
        <Sidebar collapsible="icon" variant="floating">
          <SidebarHeader>
            <div className="flex items-center gap-2 px-1 py-1">
              <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary font-heading font-bold text-primary-foreground">
                L
              </div>
              <span className="text-headline font-semibold group-data-[collapsible=icon]:hidden">
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
          {/* Topbar solo en escritorio, en vidrio sutil: el contenido pasa por debajo al bajar. */}
          <header className="pwa-safe-top liquid-glass sticky top-0 z-10 hidden min-h-16 shrink-0 items-center gap-2 border-b border-border px-4 shadow-none md:flex lg:px-6">
            <SidebarTrigger className="size-9 rounded-full" />
            {title && (
              <h1 className="text-title-3 font-semibold">
                {title}
              </h1>
            )}
            {/* Escritorio: crear, buscar y después el selector de mes, en ese orden. Buscar y crear
                viven en el topbar, no flotando: tapaban la esquina de la columna derecha. "Movimiento"
                sigue en todas las vistas: es el único botón para registrar desde Inicio, Recurrentes
                o Ajustes en escritorio (en móvil vive en Movimientos). */}
            <div className="ml-auto flex items-center gap-2">
              {openAdd && (
                <Button
                  onClick={openAdd}
                  title="Nuevo movimiento (N)"
                  className="h-9 rounded-full px-4"
                >
                  <Plus className="size-4" />
                  Movimiento
                </Button>
              )}
              {/* Campo de búsqueda de la toolbar: en ancho, cápsula con su atajo; en angosto, solo
                  la lupa. Abre la búsqueda de la vista, no escribe aquí. */}
              {onSearch && (
                <button
                  type="button"
                  onClick={onSearch}
                  aria-label="Buscar movimientos"
                  title="Buscar (/ o Ctrl K)"
                  className="press flex size-9 shrink-0 items-center justify-center gap-2 rounded-full bg-(--glass-control) text-subheadline text-muted-foreground transition-colors hover:bg-accent hover:text-foreground lg:w-56 lg:justify-start lg:px-3"
                >
                  <Search className="size-4 shrink-0" />
                  <span className="hidden flex-1 text-left lg:inline">
                    Buscar
                  </span>
                  <kbd className="hidden rounded-md bg-card px-1.5 font-sans text-caption lg:inline">
                    /
                  </kbd>
                </button>
              )}
              {actions}
            </div>
          </header>
          {/* Móvil: controles flotantes en vidrio (iOS 26), sin barra a lo ancho. Izquierda, el menú
              de la cuenta (avatar); centro, una cápsula con las acciones de la vista (el selector de
              mes, que trae su cápsula) o, sin ellas, el título cuando el título grande ya se fue con el scroll; derecha,
              la acción de la vista (el "+" de Movimientos). La búsqueda vive abajo, junto a las
              pestañas. Detrás, un fundido del fondo para que lo que pasa por debajo no choque
              con la franja de estado. Solo los controles reciben toques. */}
          <div className="pwa-safe-top pointer-events-none sticky top-0 z-20 bg-linear-to-b from-background from-55% to-transparent px-4 pt-2 pb-5 md:hidden">
            <div className="flex w-full items-start justify-between gap-2 *:pointer-events-auto">
              <UserMenu
                user={user}
                onSignOut={onSignOut}
                trigger={
                  <button
                    className="press liquid-glass grid size-11 shrink-0 place-items-center rounded-full"
                    aria-label="Perfil"
                    onClick={() => haptic("light")}
                  >
                    <Avatar className="size-8 rounded-full after:hidden">
                      <AvatarFallback className="rounded-full bg-transparent text-subheadline font-semibold text-foreground">
                        {user.initial}
                      </AvatarFallback>
                    </Avatar>
                  </button>
                }
              />
              {/* Las acciones traen su propia cápsula de vidrio (ver el selector de mes del Inicio). */}
              {actions ? (
                <div className="flex min-w-0 justify-center">{actions}</div>
              ) : title ? (
                <div
                  aria-hidden={!hasScrolled}
                  className={cn(
                    "liquid-glass flex min-h-11 min-w-0 items-center rounded-full px-4 text-headline font-semibold transition-opacity duration-200 motion-reduce:transition-none",
                    !hasScrolled && "pointer-events-none! opacity-0"
                  )}
                >
                  <span className="truncate">{title}</span>
                </div>
              ) : null}
              {/* Sin acción, un espaciador del ancho del avatar mantiene centrada la cápsula. */}
              {showAdd && openAdd ? (
                <button
                  type="button"
                  onClick={() => {
                    haptic("medium")
                    openAdd()
                  }}
                  aria-label="Nuevo movimiento"
                  className="press liquid-glass grid size-11 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground"
                >
                  <Plus className="size-6" strokeWidth={2.25} />
                </button>
              ) : (
                <div className="invisible size-11 shrink-0" aria-hidden />
              )}
            </div>
          </div>
          {/* Aire inferior solo en móvil, por la navegación flotante (64px + margen + safe-area). En
              escritorio no flota nada. */}
          <div className="min-w-0 flex-1 pb-[calc(6rem+env(safe-area-inset-bottom))] md:pb-0">
            {children}
          </div>
        </SidebarInset>

        {/* Móvil: navegación flotante con los destinos a un toque y la búsqueda aparte. Dentro de
            un AppFrame la pone el marco, una sola vez para toda la app, y la búsqueda entra en su
            hueco por un portal. */}
        {frame
          ? frame.searchSlot &&
            searchButton &&
            createPortal(searchButton, frame.searchSlot)
          : (
          <BottomNav
            active={active}
            onNavigate={onNavigate}
            trailing={searchButton}
          />
        )}
        {!frame && quickAdd && (
          <QuickAddSheet
            open={addOpen}
            onOpenChange={setAddOpen}
            quickAdd={quickAdd}
          />
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
  const activeKey = active ?? navKeyOf(pathname)

  return (
    <SidebarMenu>
      {NAV.map(({ key, label, Icon, href }) => (
        <SidebarMenuItem key={key}>
          {/* Activo: la misma pastilla translúcida y el mismo azul que la pestaña activa móvil. */}
          <SidebarMenuButton
            asChild
            isActive={activeKey === key}
            tooltip={label}
            className="h-9 text-subheadline data-active:bg-(--glass-active) data-active:font-semibold data-active:text-primary"
          >
            <Link
              href={href}
              prefetch
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

// Navegación inferior (solo móvil), flotante como en iOS 26: una cápsula de vidrio con los mismos
// destinos del sidebar y, suelta a la derecha, la búsqueda de la vista (`trailing`, o el hueco
// `slotRef` donde el AppShell la monta por portal cuando la barra es del AppFrame). La pastilla
// del activo se desliza de una pestaña a otra: como la barra vive en el layout y no se desmonta al
// navegar, basta una transición de transform.
function BottomNav({
  active,
  onNavigate,
  trailing,
  slotRef,
}: {
  active?: NavKey
  onNavigate?: (key: NavKey) => void
  trailing?: React.ReactNode
  slotRef?: React.Ref<HTMLDivElement>
}) {
  const pathname = usePathname()
  const router = useRouter()
  // Toque optimista: la pestaña tocada se marca al instante, sin esperar a que llegue la página.
  // Dura lo que dura la navegación (su transición); al terminar —llegó, falló o se volvió atrás—
  // manda el pathname.
  const [optimisticKey, setOptimisticKey] = React.useOptimistic(
    navKeyOf(pathname)
  )
  const activeKey = active ?? optimisticKey
  const activeIndex = BOTTOM_NAV.findIndex((n) => n.key === activeKey)

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 flex items-center gap-3 px-4 pb-[max(env(safe-area-inset-bottom),0.75rem)] md:hidden">
      <nav
        aria-label="Navegación principal"
        className="liquid-glass pointer-events-auto flex h-16 min-w-0 flex-1 rounded-full p-1"
      >
        <div className="relative flex min-w-0 flex-1">
          {/* translateX en % del propio ancho (una pestaña): n pestañas = n × 100%. */}
          <span
            aria-hidden
            className={cn(
              "pointer-events-none absolute inset-y-0 left-0 flex transition-[transform,opacity] duration-[240ms] ease-[cubic-bezier(0.2,0.8,0.2,1)] motion-reduce:transition-none",
              activeIndex < 0 && "opacity-0"
            )}
            style={{
              width: `${100 / BOTTOM_NAV.length}%`,
              transform: `translateX(${Math.max(activeIndex, 0) * 100}%)`,
            }}
          >
            <span className="liquid-glass-active w-full rounded-full" />
          </span>
          {BOTTOM_NAV.map(({ key, label, Icon, href }) => {
            const isActive = activeKey === key
            return (
          <Link
            key={key}
            href={href}
            prefetch
            aria-current={isActive ? "page" : undefined}
            onClick={(e) => {
              haptic("light")
              onNavigate?.(key)
              if (pathname === href) {
                window.scrollTo({ top: 0, behavior: "smooth" })
                return
              }
              // Ctrl/⌘/Shift/Alt-clic sigue siendo del navegador (pestaña nueva, descargar).
              if (
                e.button !== 0 ||
                e.metaKey ||
                e.ctrlKey ||
                e.shiftKey ||
                e.altKey
              )
                return
              e.preventDefault()
              React.startTransition(() => {
                setOptimisticKey(key)
                router.push(href)
              })
            }}
            className={cn(
              "press relative flex min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-full",
              isActive ? "text-primary" : "text-foreground"
            )}
          >
            <Icon className="size-5 shrink-0" />
            <span className="max-w-full truncate px-1 text-[10px] leading-none font-medium">
              {label}
            </span>
          </Link>
            )
          })}
        </div>
      </nav>
      {trailing}
      {slotRef && <div ref={slotRef} className="contents" />}
    </div>
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
            {/* Sin el aro del Avatar de shadcn (`after:border`): con el relleno ya se lee el círculo. */}
            <Avatar className="size-8 rounded-full bg-primary after:hidden">
              <AvatarFallback className="rounded-full bg-primary text-subheadline font-semibold text-primary-foreground">
                {user.initial}
              </AvatarFallback>
            </Avatar>
            <div className="grid flex-1 text-left leading-tight group-data-[collapsible=icon]:hidden">
              <span className="truncate text-subheadline font-medium">{user.name}</span>
              {user.email && (
                <span className="truncate text-footnote text-muted-foreground">
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
          {/* icono/texto por CSS anclado al <html> (next-themes): [html.dark_&] mira solo el tema
              real. Sin mismatch de hidratación ni useEffect. */}
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
