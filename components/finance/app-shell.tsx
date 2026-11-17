"use client"

import { toast } from "sonner"

import * as React from "react"
import { createPortal } from "react-dom"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { navDirection, reverseNav, type NavDirection } from "@/lib/nav-direction"
import { useAppearance } from "@/components/appearance-provider"
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
  List,
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
import { ResponsivePopover, modalActionRow } from "@/components/ui/responsive-modal"
import { cn } from "@/lib/utils"
import { haptic } from "@/lib/haptics"
import { authClient } from "@/lib/auth-client"
import { InstallAppItem } from "@/components/pwa/install-app-item"
import { TransactionSearch } from "./transaction-search"
import { TransactionModal } from "./transaction-modal"
import { MonthNav } from "./month-nav"
import { ProfileSheet } from "./profile-sheet"
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
export type NavKey = "inicio" | "recurrentes" | "movimientos" | "configuracion"

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
    Icon: List,
    href: "/movements",
  },
  // Un solo nombre por sección: el mismo en la barra lateral, la inferior y el título.
  { key: "configuracion", label: "Ajustes", Icon: Settings, href: "/settings" },
]

// El perfil no es una ruta: es una hoja (ProfileSheet) que se abre desde la fila de la cuenta en
// Ajustes (móvil) y desde el menú de la cuenta del sidebar (escritorio).
// Ancho relativo de cada pestaña: las etiquetas largas («Recurrentes», «Movimientos») reciben más
// que las cortas, así a 375 px entran completas a 12 px sin cortarse. Bajo 375 px «Movimientos» pasa
// a «Movim.» (`short`), nunca a «…».
const TAB: Partial<Record<NavKey, { weight: number; short?: string }>> = {
  inicio: { weight: 0.8 },
  recurrentes: { weight: 1.2 },
  movimientos: { weight: 1.2, short: "Movim." },
  configuracion: { weight: 0.8 },
}
const BOTTOM_NAV = NAV.map((n) => ({
  ...n,
  weight: TAB[n.key]?.weight ?? 1,
  short: TAB[n.key]?.short,
}))
const TAB_TOTAL = BOTTOM_NAV.reduce((sum, n) => sum + n.weight, 0)

function navKeyOf(pathname: string): NavKey | undefined {
  return NAV.find(
    (n) => pathname === n.href || pathname.startsWith(n.href + "/")
  )?.key
}

// Huecos de la barra persistente donde cada vista deja sus acciones (el MonthNav): uno en la
// topbar de escritorio y otro en la fila superior móvil. La vista los llena con un portal, así la
// barra no se monta ni se desmonta al navegar.
type Slots = { desktop: HTMLElement | null; mobile: HTMLElement | null }
const SlotsContext = React.createContext<Slots | null>(null)

// Abre la hoja del perfil, que vive una vez en el AppFrame. Fuera del marco (mocks) no hay hoja.
const OpenProfileContext = React.createContext<(() => void) | null>(null)
export const useOpenProfile = () => React.useContext(OpenProfileContext)

// Escribiendo en un campo o con un diálogo abierto, las teclas son de ese campo o diálogo.
function shortcutBlocked(e: KeyboardEvent) {
  const target = e.target as HTMLElement | null
  return (
    !!target?.closest("input, textarea, select, [contenteditable=true]") ||
    !!document.querySelector('[role="dialog"], [role="alertdialog"]')
  )
}

type User = { name: string; initial: string; email?: string }

// Marco de las pantallas con sesión (layout de app/(app)): sidebar, topbar, fila superior móvil,
// barra inferior y búsqueda viven aquí una sola vez y no se desmontan entre rutas, así sus
// transiciones siguen de una vista a otra. La búsqueda es global: el círculo de la barra inferior,
// la cápsula de la topbar y los atajos "/" y Ctrl/⌘+K la abren desde cualquier vista.
export function AppFrame({
  user,
  accounts,
  categories,
  amountBounds,
  currentPeriod,
  children,
}: {
  user: User
  accounts: AccountDTO[]
  categories: CategoryDTO[]
  amountBounds: AmountBoundsDTO
  // Período en curso según el modo; con él el marco llena la fila de las vistas sin selector de mes.
  currentPeriod: {
    year: number
    month: number
    cycleRange?: { start: string; end: string }
  }
  children: React.ReactNode
}) {
  const router = useRouter()
  const [searchOpen, setSearchOpen] = React.useState(false)
  // Movimiento elegido en la búsqueda: su editor se abre anidado dentro de ella.
  const [searchTx, setSearchTx] = React.useState<TransactionDTO | null>(null)
  // Los huecos se guardan desde su ref callback (no desde un efecto): al tenerlos, las vistas
  // montan sus portales en el render siguiente.
  const [desktopSlot, setDesktopSlot] = React.useState<HTMLElement | null>(null)
  const [mobileSlot, setMobileSlot] = React.useState<HTMLElement | null>(null)
  const slots = React.useMemo(
    () => ({ desktop: desktopSlot, mobile: mobileSlot }),
    [desktopSlot, mobileSlot]
  )
  // Sin haptic propio: ResponsiveModal ya vibra al abrir.
  const openSearch = React.useCallback(() => setSearchOpen(true), [])
  const [profileOpen, setProfileOpen] = React.useState(false)
  const openProfile = React.useCallback(() => setProfileOpen(true), [])

  async function signOut() {
    // Mismo cierre que Ajustes: el rechazo del servidor llega en `error`, no como excepción.
    const { error } = await authClient
      .signOut()
      .catch(() => ({ error: true }))
    if (error) return toast.error("No se pudo cerrar la sesión. Inténtalo de nuevo.")
    router.push("/login")
  }

  useNavDirection()

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
    <SlotsContext.Provider value={slots}>
      <OpenProfileContext.Provider value={openProfile}>
        <Chrome
          user={user}
          onSignOut={signOut}
          onProfile={openProfile}
          onSearch={openSearch}
          desktopSlotRef={setDesktopSlot}
          mobileSlotRef={setMobileSlot}
          idle={
            <MonthNav
              period={currentPeriod}
              current={currentPeriod}
              cycleRange={currentPeriod.cycleRange}
              onNavigate={() => {}}
              disabled
            />
          }
        >
          {children}
        </Chrome>
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
        <ProfileSheet
          open={profileOpen}
          onOpenChange={setProfileOpen}
          user={user}
        />
      </OpenProfileContext.Provider>
    </SlotsContext.Provider>
  )
}

// Deja en <html> hacia dónde va la próxima navegación (`data-nav-dir`, que lee la view transition
// de AppShell en globals.css), antes de que llegue la página: en el clic de cualquier enlace interno
// que cambia de ruta (captura, antes de su onClick: Link y la barra inferior siempre hacen
// preventDefault y navegan ellos, así que defaultPrevented no sirve para saber si hubo navegación) y
// en el atrás/adelante del navegador. Una pila corta de lo visitado hace que el atrás deshaga el
// último movimiento en sentido contrario («Ver todos ›» entra desde la derecha; volver, desde la
// izquierda). Un enlace puede forzar la suya con `data-nav`. La marca se borra cuando la ruta ya
// cambió y la transición terminó, así un router.push posterior sin enlace no hereda una vieja.
function useNavDirection() {
  const pathname = usePathname()
  const markId = React.useRef(0)

  React.useEffect(() => {
    const tabs = NAV.map((n) => n.href)
    const root = document.documentElement
    const stack: { path: string; dir: NavDirection | null }[] = [
      { path: location.pathname, dir: null },
    ]
    let stale: ReturnType<typeof setTimeout> | undefined
    const mark = (dir: NavDirection | null) => {
      const id = ++markId.current
      clearTimeout(stale)
      if (!dir) return void delete root.dataset.navDir
      root.dataset.navDir = dir
      // ponytail: si la navegación nunca llega (cancelada), la marca caduca sola; una página que
      // tarde más que esto en llegar entra sin desplazamiento.
      stale = setTimeout(() => {
        if (markId.current === id) delete root.dataset.navDir
      }, 5000)
    }
    const push = (path: string, dir: NavDirection | null) => {
      stack.push({ path, dir })
      if (stack.length > 20) stack.shift()
    }
    function onClick(e: MouseEvent) {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const a = (e.target as Element | null)?.closest?.("a[href]")
      if (!(a instanceof HTMLAnchorElement) || a.origin !== location.origin) return
      if ((a.target && a.target !== "_self") || a.hasAttribute("download")) return
      const from = location.pathname
      if (a.pathname === from) return // misma ruta (query, #hash): no hay desplazamiento
      const forced = a.dataset.nav as NavDirection | undefined
      const dir = forced ?? navDirection(from, a.pathname, tabs)
      mark(dir)
      push(a.pathname, dir)
    }
    function onPop() {
      const to = location.pathname
      const top = stack[stack.length - 1]
      if (top.path === to) return mark(null)
      if (stack.length > 1 && stack[stack.length - 2].path === to) {
        stack.pop()
        return mark(top.dir && reverseNav[top.dir])
      }
      const dir = navDirection(top.path, to, tabs)
      push(to, dir)
      mark(dir)
    }
    document.addEventListener("click", onClick, true)
    window.addEventListener("popstate", onPop)
    return () => {
      clearTimeout(stale)
      delete document.documentElement.dataset.navDir
      document.removeEventListener("click", onClick, true)
      window.removeEventListener("popstate", onPop)
    }
  }, [])

  // Llegó la ruta nueva: la transición ya arrancó con la marca. Se borra al terminar el
  // deslizamiento (--nav-duration 280 ms + margen); borrarla antes cortaría la animación, que lee
  // `data-nav-dir` mientras corre. Si otra navegación marcó entretanto, se respeta la suya.
  React.useEffect(() => {
    const root = document.documentElement
    if (!root.dataset.navDir) return
    const id = markId.current
    const t = setTimeout(() => {
      if (markId.current === id) delete root.dataset.navDir
    }, 400)
    return () => clearTimeout(t)
  }, [pathname])
}

// Dentro del AppFrame solo cuentan `actions` y `children`; lo demás es para los mocks de /design,
// que dibujan el marco completo.
type AppShellProps = {
  user?: User
  active?: NavKey
  onNavigate?: (key: NavKey) => void
  onSignOut?: () => void
  title?: string
  actions?: React.ReactNode // barra superior: el selector de mes u otros
  children: React.ReactNode
}

// Lo que cada vista declara de su marco. Dentro del AppFrame solo aporta sus acciones, por portal a
// los huecos de la barra persistente; usuario, título y cierre de sesión los pone el marco (el
// título sale de la ruta). Sin marco (mocks de /design) dibuja el marco completo.
export function AppShell({ actions, children, ...props }: AppShellProps) {
  const slots = React.useContext(SlotsContext)
  if (!slots)
    return (
      <Chrome {...props} actions={actions}>
        {children}
      </Chrome>
    )
  return (
    <>
      {/* Cambio de pantalla: el contenido de la vista que sale y el de la que entra se deslizan
          (clase `nav`, globals.css); dentro de la misma ruta (mes, `?tx=`, refresh) no anima. */}
      <React.ViewTransition enter="nav" exit="nav" default="none">
        {children}
      </React.ViewTransition>
      {actions && slots.desktop && createPortal(actions, slots.desktop)}
      {actions && slots.mobile && createPortal(actions, slots.mobile)}
    </>
  )
}

// El marco visible: sidebar shadcn flotante (drawer en móvil), topbar flotante en escritorio y
// controles flotantes en móvil.
function Chrome({
  user,
  active,
  onNavigate,
  onSignOut,
  onProfile,
  onSearch,
  title: titleProp,
  actions,
  desktopSlotRef,
  mobileSlotRef,
  idle,
  children,
}: Omit<AppShellProps, "actions"> & {
  actions?: React.ReactNode
  idle?: React.ReactNode // el MonthNav deshabilitado: ocupa el hueco cuando la vista no trae acciones
  onSearch?: () => void
  onProfile?: () => void
  desktopSlotRef?: (el: HTMLElement | null) => void
  mobileSlotRef?: (el: HTMLElement | null) => void
}) {
  const pathname = usePathname()
  const title =
    titleProp ?? NAV.find((n) => n.key === navKeyOf(pathname))?.label
  const { topRef, scrolled } = useScrolled()

  return (
    <TooltipProvider delayDuration={0}>
      <SidebarProvider>
        {/* Escritorio: sidebar en el papel, separado del contenido por un filete interior; el ítem
            activo va en superficie. En móvil sigue siendo el drawer. */}
        <Sidebar collapsible="icon">
          <SidebarHeader className="px-4 pt-3">
            <div className="flex min-h-10 items-center gap-3 px-2 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
              <div className="grid size-8 shrink-0 place-items-center rounded-sm bg-primary font-semibold text-primary-foreground">
                L
              </div>
              <span className="text-title font-semibold text-foreground group-data-[collapsible=icon]:hidden">
                Luca Plan
              </span>
            </div>
          </SidebarHeader>

          <SidebarContent className="px-2">
            <SidebarGroup>
              <NavMenu active={active} onNavigate={onNavigate} />
            </SidebarGroup>
          </SidebarContent>

          <SidebarFooter className="px-4 pb-4">
            {user && (
              <UserMenu user={user} onSignOut={onSignOut} onProfile={onProfile} />
            )}
          </SidebarFooter>
        </Sidebar>

        <SidebarInset className="min-w-0 bg-background">
          {/* Marca de "arriba del todo": deja de verse con el primer píxel de scroll. */}
          <div ref={topRef} aria-hidden className="-mb-px h-px" />
          {/* Escritorio: barra pegada de 64 px con fondo propio; sus bordes son los del contenido
              (mismo max-width y padding que page-container). Con scroll gana un filete abajo. */}
          <div
            style={{ viewTransitionName: "app-topbar" }}
            data-scrolled={scrolled || undefined}
            className="sticky top-0 z-10 hidden border-b border-transparent bg-background transition-colors duration-200 data-scrolled:border-border md:block"
          >
            <header className="flex h-16 items-center gap-3 px-[max(2rem,calc((100%-var(--page-max))/2+2rem))]">
              <SidebarTrigger className="size-(--ctl) shrink-0 rounded-md border border-border bg-card text-ink-2 hover:border-rule-strong hover:bg-card hover:text-foreground" />
              {title && (
                <h1 className="mx-1 text-title font-semibold">{title}</h1>
              )}
              {/* Las acciones de la vista (el selector de mes) van junto al título; sin ellas, el mismo
                  selector deshabilitado con el período en curso. La búsqueda global, al final. */}
              <div
                ref={desktopSlotRef}
                className="peer flex items-center empty:hidden"
              >
                {actions}
              </div>
              {idle && (
                <div className="hidden items-center peer-empty:flex">
                  {idle}
                </div>
              )}
              {/* Búsqueda global: abre el mismo modal que el botón de la barra móvil. */}
              {onSearch && (
                <button
                  type="button"
                  onClick={onSearch}
                  aria-label="Buscar movimientos"
                  title="Buscar (/ o Ctrl K)"
                  className="press ml-auto flex h-(--ctl) w-(--ctl) shrink-0 items-center justify-center gap-2 rounded-md border border-border bg-card text-callout text-ink-3 hover:border-rule-strong hover:text-foreground lg:w-[min(22.5rem,30vw)] lg:justify-start lg:pr-2 lg:pl-3"
                >
                  <Search className="size-4 shrink-0" />
                  <span className="hidden flex-1 text-left lg:inline">
                    Buscar movimientos
                  </span>
                  <kbd className="hidden min-w-6 rounded-xs bg-secondary px-1 text-center font-sans text-caption text-ink-3 ring-1 ring-border ring-inset lg:inline">
                    /
                  </kbd>
                </button>
              )}
            </header>
          </div>
          {/* Móvil (G): barra pegada con fondo propio (su transparencia y desenfoque los mueve el nivel
              de Apariencia) y un desvanecido corto debajo. A la izquierda el avatar abre la hoja de la
              cuenta; al centro las acciones de la vista (el selector de mes) y, sin ellas, el selector
              deshabilitado con el período en curso, así la fila es igual en todas las vistas; a la
              derecha, la búsqueda. Todo a 44 px y margen 16. */}
          <div
            data-scrolled={scrolled || undefined}
            style={{ viewTransitionName: "app-top-mobile" }}
            className="top-bar pwa-safe-top sticky top-0 z-20 flex items-center gap-2 bg-float px-4 py-2 backdrop-blur-(--float-blur) after:pointer-events-none after:absolute after:inset-x-0 after:top-full after:h-4 after:bg-linear-to-b after:from-background after:to-transparent md:hidden"
          >
            {user && (
              <UserMenu
                user={user}
                onSignOut={onSignOut}
                onProfile={onProfile}
                compact
              />
            )}
            {/* El título de la vista no se dibuja en la barra móvil (como en G): queda para el lector. */}
            {title && <h1 className="sr-only">{title}</h1>}
            <div className="grid min-h-11 min-w-0 flex-1 items-center *:col-start-1 *:row-start-1">
              {idle && (
                <div className="top-idle flex w-full min-w-0">
                  {idle}
                </div>
              )}
              <div
                ref={mobileSlotRef}
                data-top-actions
                className="flex w-full min-w-0"
              >
                {actions}
              </div>
            </div>
            {onSearch && (
              <button
                type="button"
                onClick={onSearch}
                aria-label="Buscar movimientos"
                className="press grid size-(--ctl) shrink-0 place-items-center rounded-md border border-border bg-card text-ink-2 hover:border-rule-strong hover:text-foreground"
              >
                <Search aria-hidden className="size-5" />
              </button>
            )}
          </div>
          {/* Aire inferior solo en móvil, por la barra flotante. En escritorio no flota nada. */}
          <div className="min-w-0 flex-1 pb-[calc(6rem+var(--tab-bar-inset))] md:pb-0">
            {children}
          </div>
        </SidebarInset>

        <BottomNav
          active={active}
          onNavigate={onNavigate}
        />
      </SidebarProvider>
    </TooltipProvider>
  )
}

// El título móvil se recoge cuando la marca de arriba deja de verse, sin escuchar cada scroll.
function useScrolled() {
  const topRef = React.useRef<HTMLDivElement>(null)
  const [scrolled, setScrolled] = React.useState(false)

  React.useEffect(() => {
    const top = topRef.current
    if (!top) return
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.target === top) setScrolled(!e.isIntersecting)
      }
    })
    io.observe(top)
    return () => io.disconnect()
  }, [])

  return { topRef, scrolled }
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
    <SidebarMenu className="gap-1">
      {NAV.map(({ key, label, Icon, href }) => (
        <SidebarMenuItem key={key}>
          <SidebarMenuButton
            asChild
            isActive={activeKey === key}
            tooltip={label}
            className="press [&_svg]:size-5"
          >
            <Link
              href={href}
              aria-current={activeKey === key ? "page" : undefined}
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

// Navegación inferior (solo móvil), flotante: una barra redondeada con los mismos destinos del
// sidebar (la búsqueda va en la barra superior). Debajo, el fondo se desvanece para que el
// contenido no se lea a través. La selección es un tono (surface-2) que se desliza de una pestaña a
// otra con la misma duración y curva que el contenido (`.tab-pill`); la etiqueta activa sube a
// tinta primaria sin cambiar de peso, así ningún ancho cambia. Su transparencia y desenfoque los
// mueve el nivel de Apariencia (`float`).
function BottomNav({
  active,
  onNavigate,
}: {
  active?: NavKey
  onNavigate?: (key: NavKey) => void
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
  const pill = BOTTOM_NAV[Math.max(activeIndex, 0)]
  const pillLeft = BOTTOM_NAV.slice(0, Math.max(activeIndex, 0)).reduce(
    (sum, n) => sum + n.weight,
    0
  )

  return (
    <div
      // Nombre propio en el cambio de pantalla: la barra queda quieta encima del contenido que se desliza.
      style={{ viewTransitionName: "app-tabbar" }}
      className="pointer-events-none fixed right-[env(safe-area-inset-right)] bottom-0 left-[env(safe-area-inset-left)] z-30 flex items-center gap-3 bg-linear-to-b from-transparent to-background to-45% px-4 pt-6 pb-(--tab-bar-inset) md:hidden"
    >
      <nav
        aria-label="Navegación principal"
        className="float pointer-events-auto flex h-15 min-w-0 flex-1 rounded-full p-1"
      >
        <div className="relative flex min-w-0 flex-1">
          {/* Las pestañas no miden lo mismo: la pastilla se ubica con left/right en % de la fila
              (es un elemento chico; animarlos no pesa). */}
          <span
            aria-hidden
            className={cn(
              "tab-pill pointer-events-none absolute inset-y-0 flex",
              activeIndex < 0 && "opacity-0"
            )}
            style={{
              left: `${(pillLeft / TAB_TOTAL) * 100}%`,
              right: `${((TAB_TOTAL - pillLeft - pill.weight) / TAB_TOTAL) * 100}%`,
            }}
          >
            <span className="w-full rounded-full bg-secondary" />
          </span>
          {BOTTOM_NAV.map(({ key, label, short, weight, Icon, href }) => {
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
                style={{ flexGrow: weight }}
                // Sin negrita en la activa: la marcan la pastilla, el azul y aria-current; un peso distinto
                // ensancharía su etiqueta y movería a las vecinas bajo la pastilla.
                className="press relative flex min-w-0 basis-0 flex-col items-center justify-center gap-0.5 rounded-full text-ink-3 aria-[current=page]:text-foreground"
              >
                <Icon className="size-5 shrink-0" />
                {short ? (
                  <span className="text-caption whitespace-nowrap">
                    <span className="max-[375px]:sr-only">{label}</span>
                    <span aria-hidden className="min-[375px]:hidden">{short}</span>
                  </span>
                ) : (
                  <span className="text-caption whitespace-nowrap">{label}</span>
                )}
              </Link>
            )
          })}
        </div>
      </nav>
    </div>
  )
}

// Menú de la cuenta: en el pie del sidebar de escritorio y, `compact`, en el avatar de la barra
// superior móvil. Nace de su botón. El tema vive aquí (y en Ajustes), no en la barra.
function UserMenu({
  user,
  onSignOut,
  onProfile,
  compact = false,
}: {
  user: User
  onSignOut?: () => void
  onProfile?: () => void
  compact?: boolean
}) {
  const { toggleTheme } = useAppearance()
  // «Perfil» abre la hoja recién cuando el menú terminó de cerrarse y Radix devolvió el foco a su
  // botón: así la hoja lo guarda como opener y, al cerrarla, el foco vuelve ahí y no a <body>.
  const pendingProfile = React.useRef(false)
  const [sheetOpen, setSheetOpen] = React.useState(false)

  // Móvil: el avatar abre la hoja «Tu cuenta» desde abajo, con filas de 48 px (como en G).
  if (compact) {
    const row = cn(modalActionRow, "min-h-12")
    return (
      <ResponsivePopover
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        title="Tu cuenta"
        trigger={
          <button
            type="button"
            aria-label={"Cuenta de " + (user.name || user.email || "")}
            className="press grid size-(--ctl) shrink-0 place-items-center rounded-full"
          >
            <span className="grid size-9 place-items-center rounded-full bg-primary-soft text-callout font-semibold text-primary">
              {user.initial}
            </span>
          </button>
        }
      >
        <div className="flex min-w-0 items-center gap-3 pb-4">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary-soft text-callout font-semibold text-primary">
            {user.initial}
          </span>
          <span className="grid min-w-0">
            <span className="truncate font-semibold">{user.name || user.email}</span>
            {user.name && user.email && (
              <span className="truncate text-callout text-ink-2">{user.email}</span>
            )}
          </span>
        </div>
        <div className="tone-rows">
          {onProfile && (
            <button
              type="button"
              className={row}
              onClick={() => {
                setSheetOpen(false)
                onProfile()
              }}
            >
              <UserRound aria-hidden className="text-ink-2" />
              Perfil
            </button>
          )}
          <button
            type="button"
            className={row}
            onClick={() => {
              haptic("light")
              toggleTheme()
            }}
          >
            <Sun aria-hidden className="hidden text-ink-2 [html.dark_&]:block" />
            <Moon aria-hidden className="text-ink-2 [html.dark_&]:hidden" />
            <span className="hidden [html.dark_&]:inline">Tema claro</span>
            <span className="[html.dark_&]:hidden">Tema oscuro</span>
          </button>
          {/* Solo aparece si hay vía de instalación y la app no corre ya instalada */}
          <InstallAppItem rowClassName={row} />
        </div>
        <div className="tone-rows mt-3">
          <button
            type="button"
            className={cn(row, "font-semibold text-destructive hover:bg-destructive-soft")}
            onClick={() => {
              setSheetOpen(false)
              onSignOut?.()
            }}
          >
            <LogOut aria-hidden />
            Cerrar sesión
          </button>
        </div>
      </ResponsivePopover>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <SidebarMenuButton
            size="lg"
            className="min-h-14 rounded-lg px-2 data-[state=open]:bg-secondary [&_svg]:size-4"
          >
            {/* Sin el aro del Avatar de shadcn (`after:border`): con el relleno ya se lee el círculo. */}
            <Avatar className="size-9 rounded-full after:hidden">
              <AvatarFallback className="rounded-full bg-primary-soft text-callout font-semibold text-primary">
                {user.initial}
              </AvatarFallback>
            </Avatar>
            <div className="grid flex-1 text-left group-data-[collapsible=icon]:hidden">
              <span className="truncate text-callout font-semibold text-foreground">
                {user.name || user.email}
              </span>
              {user.email && (
                <span className="truncate text-caption text-ink-3">
                  {user.email}
                </span>
              )}
            </div>
            <ChevronsUpDown className="ml-auto text-ink-3 group-data-[collapsible=icon]:hidden" />
          </SidebarMenuButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align="start"
        className="w-60"
        onCloseAutoFocus={() => {
          if (!pendingProfile.current) return
          pendingProfile.current = false
          onProfile?.()
        }}
      >
        <DropdownMenuLabel className="font-normal">
          <div className="grid leading-tight">
            <span className="truncate text-callout font-semibold text-foreground">
              {user.name || user.email}
            </span>
            {user.email && (
              <span className="truncate text-caption text-ink-3">
                {user.email}
              </span>
            )}
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {onProfile && (
          <DropdownMenuItem
            onSelect={() => {
              pendingProfile.current = true
            }}
          >
            <UserRound className="size-4" />
            Perfil
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault() // no cerrar el menú al alternar
            haptic("light")
            toggleTheme()
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
