"use client"

import * as React from "react"
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
  Search,
  ListFilter,
} from "lucide-react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
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
import { TransactionSearch } from "./transaction-search"
import { TransactionModal } from "./transaction-modal"
import type {
  AccountDTO,
  AmountBoundsDTO,
  CategoryDTO,
  TransactionDTO,
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

// Lo que el AppFrame le presta al AppShell: "abrir la búsqueda". Con él, el AppShell no monta su
// propia barra inferior: usa la del marco, que vive una sola vez para toda la app.
type Frame = { openSearch: () => void }
const FrameContext = React.createContext<Frame | null>(null)

// Escribiendo en un campo o con un diálogo abierto, las teclas son de ese campo o diálogo.
function shortcutBlocked(e: KeyboardEvent) {
  const target = e.target as HTMLElement | null
  return (
    !!target?.closest("input, textarea, select, [contenteditable=true]") ||
    !!document.querySelector('[role="dialog"], [role="alertdialog"]')
  )
}

// Marco de las pantallas con sesión (layout de app/(app)): la barra inferior móvil y la búsqueda de
// movimientos quedan montadas entre rutas, sin recargarse en cada navegación. La búsqueda es global: el círculo de la barra inferior, la cápsula de la topbar y los
// atajos "/" y Ctrl/⌘+K la abren desde cualquier vista.
export function AppFrame({
  accounts,
  categories,
  amountBounds,
  children,
}: {
  accounts: AccountDTO[]
  categories: CategoryDTO[]
  amountBounds: AmountBoundsDTO
  children: React.ReactNode
}) {
  const [searchOpen, setSearchOpen] = React.useState(false)
  // Movimiento elegido en la búsqueda: su editor se abre anidado dentro de ella.
  const [searchTx, setSearchTx] = React.useState<TransactionDTO | null>(null)
  const openSearch = React.useCallback(() => {
    haptic("light")
    setSearchOpen(true)
  }, [])
  const frame = React.useMemo(() => ({ openSearch }), [openSearch])

  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (shortcutBlocked(e)) return
      const key = e.key.toLowerCase()
      if (key === "/" || (key === "k" && (e.ctrlKey || e.metaKey))) {
        e.preventDefault()
        setSearchOpen(true)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  return (
    <FrameContext.Provider value={frame}>
      {children}
      <BottomNav
        trailing={<SearchCircle onSearch={openSearch} />}
      />
      <TransactionSearch
        open={searchOpen}
        detailOpen={searchTx !== null}
        onOpenChange={setSearchOpen}
        categories={categories}
        accounts={accounts}
        amountBounds={amountBounds}
        onOpenTransaction={setSearchTx}
      >
        {searchOpen && (
          <TransactionModal
            tx={searchTx}
            categories={categories}
            accounts={accounts}
            onOpenChange={(o) => !o && setSearchTx(null)}
          />
        )}
      </TransactionSearch>
    </FrameContext.Provider>
  )
}

// Móvil: la búsqueda va suelta a la derecha de la cápsula de pestañas (iOS 26, como Música o Fotos),
// del alto de la cápsula. Está en todas las vistas, así la cápsula no cambia de ancho al navegar.
function SearchCircle({ onSearch }: { onSearch: () => void }) {
  return (
    <button
      type="button"
      onClick={onSearch}
      aria-label="Buscar movimientos"
      className="press liquid-glass pointer-events-auto grid size-16 shrink-0 place-items-center rounded-full"
    >
      <Search className="size-6" />
    </button>
  )
}

type AppShellProps = {
  user: { name: string; initial: string; email?: string }
  active?: NavKey
  onNavigate?: (key: NavKey) => void
  onSignOut?: () => void
  title?: string
  actions?: React.ReactNode // barra superior: el selector de mes u otros
  children: React.ReactNode
}

// Shell de la app: sidebar shadcn flotante (drawer en móvil), topbar flotante con acciones en
// escritorio y controles flotantes en móvil. El toggle de tema vive en el menú de usuario.
export function AppShell({
  user,
  active,
  onNavigate,
  onSignOut,
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
  const openSearch = frame?.openSearch

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
          {/* Topbar solo en escritorio, de la familia del sidebar flotante: el mismo margen al borde
              (0.5rem, el p-2 de su contenedor) y hacia el sidebar, mismo radio, mismo vidrio y alineada
              con su borde superior. Detrás, el scroll edge effect funde lo que pasa por debajo. Lo que
              va adentro tiene radio concéntrico (--radius-bar-inner). */}
          <div className="sticky top-0 z-10 hidden scroll-edge-top pt-2 pr-2 md:block">
            <header className="flex h-14 items-center gap-2 rounded-xl liquid-glass p-2 pl-3">
              <SidebarTrigger className="size-10 rounded-(--radius-bar-inner)" />
              {title && (
                <h1 className="text-title-3 font-semibold">{title}</h1>
              )}
              {/* Las acciones de la vista (el selector de mes) van junto al título; la búsqueda global,
                  al final. */}
              {actions && <div className="ml-2 flex items-center">{actions}</div>}
              <div className="ml-auto flex items-center gap-2">
                {/* Búsqueda global: abre el mismo modal que el círculo de la barra móvil. */}
                {openSearch && (
                  <button
                    type="button"
                    onClick={openSearch}
                    aria-label="Buscar movimientos"
                    title="Buscar (/ o Ctrl K)"
                    className="press flex size-10 shrink-0 items-center justify-center gap-2 rounded-(--radius-bar-inner) bg-(--glass-control) text-subheadline text-muted-foreground transition-colors hover:bg-accent hover:text-foreground lg:w-56 lg:justify-start lg:px-3"
                  >
                    <Search className="size-4 shrink-0" />
                    <span className="hidden flex-1 text-left lg:inline">
                      Buscar
                    </span>
                    <kbd className="hidden rounded-sm bg-card px-1.5 font-sans text-caption lg:inline">
                      /
                    </kbd>
                  </button>
                )}
              </div>
            </header>
          </div>
          {/* Móvil: controles flotantes en vidrio (iOS 26), sin barra a lo ancho. Izquierda, el menú
              de la cuenta (avatar); al centro y a todo el ancho libre, las acciones de la vista (el
              selector de mes) o, sin ellas, el título cuando el título grande ya se fue con el scroll;
              sin nada a la derecha. Detrás, el scroll edge effect separa los controles del
              contenido que pasa por debajo. Solo los controles reciben toques. */}
          <div className="pwa-safe-top pointer-events-none sticky top-0 z-20 px-4 pt-2 pb-3 md:hidden">
            <div className="flex w-full items-center gap-2 *:pointer-events-auto">
              <UserMenu
                user={user}
                onSignOut={onSignOut}
                side="bottom"
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
              {actions ? (
                <div className="flex min-w-0 flex-1">{actions}</div>
              ) : (
                <div className="flex min-w-0 flex-1 justify-center">
                  {title && (
                    <div
                      aria-hidden={!hasScrolled}
                      className={cn(
                        "liquid-glass flex min-h-11 min-w-0 items-center rounded-full px-4 text-headline font-semibold transition-opacity duration-200 motion-reduce:transition-none",
                        !hasScrolled && "pointer-events-none! opacity-0"
                      )}
                    >
                      <span className="truncate">{title}</span>
                    </div>
                  )}
                </div>
              )}
              {/* Sin selector, un espaciador del ancho del avatar mantiene centrado el título. */}
              {!actions && <div className="invisible size-11 shrink-0" aria-hidden />}
            </div>
          </div>
          {/* Aire inferior solo en móvil, por la navegación flotante (64px + margen + safe-area). En
              escritorio no flota nada. */}
          <div className="min-w-0 flex-1 pb-[calc(6rem+env(safe-area-inset-bottom))] md:pb-0">
            {children}
          </div>
        </SidebarInset>

        {/* Móvil: navegación flotante. Dentro de un AppFrame la pone el marco, una sola vez para
            toda la app y con la búsqueda; sin marco (mocks de /design) la pone el shell. */}
        {!frame && <BottomNav active={active} onNavigate={onNavigate} />}
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
            className="h-9 rounded-(--radius-bar-inner) text-subheadline data-active:bg-(--glass-active) data-active:font-semibold"
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
// destinos del sidebar y, suelta a la derecha, la búsqueda (`trailing`). La pastilla del activo
// (concéntrica: rounded-full dentro de rounded-full) se desliza de una pestaña a otra: como la barra
// vive en el layout y no se desmonta al navegar, basta una transición de transform. Las etiquetas
// van en el color del texto; el activo se marca tiñendo el fondo de su pastilla.
function BottomNav({
  active,
  onNavigate,
  trailing,
}: {
  active?: NavKey
  onNavigate?: (key: NavKey) => void
  trailing?: React.ReactNode
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
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 flex items-center gap-3 scroll-edge-bottom px-4 pt-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] md:hidden">
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
                  "press relative flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-full text-foreground",
                  isActive && "font-semibold"
                )}
              >
                <Icon className="size-5 shrink-0" />
                <span className="max-w-full truncate px-1 text-caption">
                  {label}
                </span>
              </Link>
            )
          })}
        </div>
      </nav>
      {trailing}
    </div>
  )
}

function UserMenu({
  user,
  onSignOut,
  trigger,
  side = "top",
}: {
  user: AppShellProps["user"]
  onSignOut?: () => void
  trigger?: React.ReactNode // trigger alternativo (avatar móvil); default: botón del sidebar
  side?: "top" | "bottom" // abajo desde el avatar móvil, arriba desde el pie del sidebar
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
      <DropdownMenuContent side={side} align="start" className="w-56">
        <DropdownMenuLabel className="font-normal">
          <div className="grid leading-tight">
            <span className="truncate text-subheadline font-medium">{user.name}</span>
            {user.email && (
              <span className="truncate text-footnote text-muted-foreground">
                {user.email}
              </span>
            )}
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {/* En escritorio Perfil ya está en el sidebar; en móvil, el avatar es su única puerta. */}
        {trigger && (
          <DropdownMenuItem asChild>
            <Link href="/profile">
              <UserRound className="size-4" />
              Mi perfil
            </Link>
          </DropdownMenuItem>
        )}
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
