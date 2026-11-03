"use client"

import * as React from "react"
import { createPortal } from "react-dom"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import {
  navDirection,
  reverseNav,
  type NavDirection,
} from "@/lib/nav-direction"
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
import { PortalContainerContext } from "@/components/ui/portal-container"
import { cn } from "@/lib/utils"
import { haptic } from "@/lib/haptics"
import { useIsMobile } from "@/hooks/use-mobile"
import { authClient } from "@/lib/auth-client"
import { Button, Glass, TabBar } from "glisse"
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
    Icon: ListFilter,
    href: "/movements",
  },
  // Un solo nombre por sección: el mismo en la barra lateral, la inferior y el título.
  { key: "configuracion", label: "Ajustes", Icon: Settings, href: "/settings" },
]

// El perfil no es una ruta: es una hoja (ProfileSheet) que se abre desde la fila de la cuenta en
// Ajustes (móvil) y desde el menú de la cuenta del sidebar (escritorio).

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
  const [portalContainer, setPortalContainer] =
    React.useState<HTMLElement | null>(null)
  const slots = React.useMemo(
    () => ({ desktop: desktopSlot, mobile: mobileSlot }),
    [desktopSlot, mobileSlot]
  )
  // Sin haptic propio: ResponsiveModal ya vibra al abrir.
  const openSearch = React.useCallback(() => setSearchOpen(true), [])
  const [profileOpen, setProfileOpen] = React.useState(false)
  const openProfile = React.useCallback(() => setProfileOpen(true), [])

  async function signOut() {
    await authClient.signOut()
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
    <PortalContainerContext.Provider value={portalContainer}>
      <SlotsContext.Provider value={slots}>
        <OpenProfileContext.Provider value={openProfile}>
          <Chrome
            user={user}
            onSignOut={signOut}
            onProfile={openProfile}
            onSearch={openSearch}
            desktopSlotRef={setDesktopSlot}
            mobileSlotRef={setMobileSlot}
            portalContainerRef={setPortalContainer}
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
    </PortalContainerContext.Provider>
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
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
        return
      const a = (e.target as Element | null)?.closest?.("a[href]")
      if (!(a instanceof HTMLAnchorElement) || a.origin !== location.origin)
        return
      if ((a.target && a.target !== "_self") || a.hasAttribute("download"))
        return
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

// Móvil: la búsqueda va suelta a la derecha de la cápsula de pestañas (iOS 26, como Música o Fotos),
// del alto de la cápsula. Está en todas las vistas, así la cápsula no cambia de ancho al navegar.
function SearchCircle({ onSearch }: { onSearch: () => void }) {
  return (
    <Button
      onClick={onSearch}
      aria-label="Buscar movimientos"
      icon={<Search className="size-6" />}
      style={{ width: 60, height: 60 }}
      className="pointer-events-auto shrink-0"
    />
  )
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
  portalContainerRef,
  idle,
  children,
}: Omit<AppShellProps, "actions"> & {
  actions?: React.ReactNode
  idle?: React.ReactNode // el MonthNav deshabilitado: ocupa el hueco cuando la vista no trae acciones
  onSearch?: () => void
  onProfile?: () => void
  desktopSlotRef?: (el: HTMLElement | null) => void
  mobileSlotRef?: (el: HTMLElement | null) => void
  portalContainerRef?: (el: HTMLElement | null) => void
}) {
  const pathname = usePathname()
  const title =
    titleProp ?? NAV.find((n) => n.key === navKeyOf(pathname))?.label
  const { topRef, scrolled } = useScrolled()
  const isMobile = useIsMobile()

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
            {user && (
              <UserMenu
                user={user}
                onSignOut={onSignOut}
                onProfile={onProfile}
              />
            )}
          </SidebarFooter>
        </Sidebar>

        <SidebarInset className="min-w-0">
          {/* Marca de "arriba del todo": deja de verse con el primer píxel de scroll. */}
          <div ref={topRef} aria-hidden className="-mb-px h-px" />
          {/* Topbar solo en escritorio, de la familia del sidebar flotante: el mismo margen al borde
              (0.5rem, el p-2 de su contenedor) y hacia el sidebar, mismo radio, mismo vidrio y alineada
              con su borde superior. Detrás, el scroll edge effect funde lo que pasa por debajo. Lo que
              va adentro tiene radio concéntrico (--radius-bar-inner). */}
          <div
            key={`desktop-${isMobile}`}
            style={{ viewTransitionName: "app-topbar" }}
            className="sticky top-0 z-10 hidden pt-2 pr-2 md:block"
          >
            <header>
              <Glass className="flex min-h-14 items-center gap-2 rounded-xl p-2 pl-3">
                <SidebarTrigger className="size-10 rounded-(--radius-bar-inner)" />
                {title && (
                  <h1 className="text-title-3 font-semibold">{title}</h1>
                )}
                {/* Las acciones de la vista (el selector de mes) van junto al título; sin ellas, el mismo
                  selector deshabilitado con el período en curso. La búsqueda global, al final. */}
                <div
                  ref={desktopSlotRef}
                  className="peer ml-2 flex items-center empty:hidden"
                >
                  {actions}
                </div>
                {idle && (
                  <div
                    key={pathname}
                    className="ml-2 hidden items-center peer-empty:flex"
                  >
                    {idle}
                  </div>
                )}
                <div className="ml-auto flex items-center gap-2">
                  {/* Búsqueda global: abre el mismo modal que el círculo de la barra móvil. */}
                  {onSearch && (
                    <Button
                      type="button"
                      onClick={onSearch}
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
                    </Button>
                  )}
                </div>
              </Glass>
            </header>
          </div>
          {/* Móvil: controles flotantes en vidrio (iOS 26), sin barra a lo ancho. A la izquierda el
              título de la vista (el h1 de la página en móvil; el de la topbar está oculto) y el resto
              para las acciones de la vista (el selector de mes); sin ellas, en la misma celda queda el
              selector deshabilitado con el período en curso, así la fila es igual en todas las vistas
              y no salta al navegar (el cruce entre los dos, en `.top-idle`, globals.css). Con el
              primer scroll el título se va y el selector se ensancha hasta llenar la fila
              (`.top-title`). Solo las cápsulas desenfocan el fondo y reciben toques. */}
          <div
            key={`mobile-${isMobile}`}
            data-scrolled={scrolled || undefined}
            style={{ viewTransitionName: "app-top-mobile" }}
            className="top-bar pwa-safe-top pointer-events-none sticky top-0 z-20 flex items-center px-4 py-2 md:hidden"
          >
            {title && (
              <div className="top-title grid">
                <div className="min-w-0 overflow-hidden">
                  {/* key: al navegar el título entra con un fundido; la fila no se desmonta. */}
                  <h1
                    key={title}
                    className="pr-3 text-headline font-bold whitespace-nowrap"
                  >
                    {title}
                  </h1>
                </div>
              </div>
            )}
            <div className="grid min-h-11 min-w-0 flex-1 items-center *:col-start-1 *:row-start-1">
              {idle && (
                <div
                  key={pathname}
                  className="top-idle pointer-events-auto flex w-full min-w-0"
                >
                  {idle}
                </div>
              )}
              <div
                ref={mobileSlotRef}
                data-top-actions
                className="flex w-full min-w-0 *:pointer-events-auto"
              >
                {actions}
              </div>
            </div>
          </div>
          {/* Aire inferior solo en móvil, por la navegación flotante (64px + 1rem + su margen al
              borde, --tab-bar-inset). En escritorio no flota nada. */}
          <div
            data-glisse-backdrop
            className="app-glass-backdrop min-w-0 flex-1 pb-[calc(5rem+var(--tab-bar-inset))] md:pb-0"
          >
            {children}
          </div>
        </SidebarInset>

        <BottomNav
          active={active}
          onNavigate={onNavigate}
          trailing={onSearch && <SearchCircle onSearch={onSearch} />}
        />
        <div ref={portalContainerRef} data-app-portals />
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
  const activeIndex = NAV.findIndex((n) => n.key === activeKey)

  return (
    <SidebarMenu className="relative">
      {/* Pastilla del activo, como la de la barra inferior: una sola, que se desliza en vertical
          de un link a otro (paso = alto del link + gap-1; colapsado, size-8 + gap-1). */}
      <span
        aria-hidden
        style={{ "--i": Math.max(activeIndex, 0) } as React.CSSProperties}
        className={cn(
          "nav-pill pointer-events-none absolute top-0 left-0 h-9 w-full [transform:translateY(calc(var(--i)*2.5rem))] rounded-(--radius-bar-inner) bg-(--lg-selection) group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:[transform:translateY(calc(var(--i)*2.25rem))]",
          activeIndex < 0 && "opacity-0"
        )}
      />
      {NAV.map(({ key, label, Icon, href }) => (
        <SidebarMenuItem key={key}>
          {/* Mismo lenguaje que la pestaña activa móvil: la pastilla azul de arriba (--glass-tab-active)
              y el ícono y el texto en el acento. Hover y press en un velo del texto, como el resto
              de los controles sobre vidrio (el --sidebar-accent de shadcn es un gris sólido). */}
          <SidebarMenuButton
            asChild
            isActive={activeKey === key}
            tooltip={label}
            className="h-9 rounded-(--radius-bar-inner) text-subheadline hover:bg-foreground/5 active:bg-foreground/10 data-active:bg-transparent data-active:font-semibold data-active:text-primary data-active:hover:bg-transparent data-active:hover:text-primary"
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

// Glisse conserva los enlaces de Next y gestiona la selección y su movimiento.
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
  const isMobile = useIsMobile()
  return (
    <nav
      key={String(isMobile)}
      aria-label="Navegación principal"
      style={{ viewTransitionName: "app-tabbar" }}
      className="app-bottom-nav pointer-events-none fixed right-[env(safe-area-inset-right)] bottom-0 left-[env(safe-area-inset-left)] z-30 flex items-center gap-2 px-2 pt-3 pb-(--tab-bar-inset) md:hidden"
    >
      <TabBar
        className="pointer-events-auto min-w-0"
        link={Link}
        value={active ?? navKeyOf(pathname) ?? null}
        items={NAV.map(({ key, label, Icon, href }) => ({
          value: key,
          label: key === "movimientos" ? "Movim." : label,
          icon: <Icon className="size-5" />,
          href,
        }))}
        onValueChange={(value) => {
          haptic("light")
          onNavigate?.(value as NavKey)
        }}
        onClickCapture={(event) => {
          const link = (event.target as HTMLElement).closest("a")
          if (
            link?.getAttribute("href") === pathname &&
            !event.metaKey &&
            !event.ctrlKey &&
            !event.shiftKey &&
            !event.altKey
          )
            window.scrollTo({ top: 0, behavior: "smooth" })
        }}
      />
      {trailing}
    </nav>
  )
}

// Menú de la cuenta, solo en el pie del sidebar de escritorio. En móvil lo mismo vive en Ajustes.
function UserMenu({
  user,
  onSignOut,
  onProfile,
}: {
  user: User
  onSignOut?: () => void
  onProfile?: () => void
}) {
  const { toggleTheme } = useAppearance()
  // «Perfil» abre la hoja recién cuando el menú terminó de cerrarse y Radix devolvió el foco a su
  // botón: así la hoja lo guarda como opener y, al cerrarla, el foco vuelve ahí y no a <body>.
  const pendingProfile = React.useRef(false)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label="Menú de la cuenta"
          style={{ width: "100%", minHeight: 48, padding: 8 }}
          className="gap-2 group-data-[collapsible=icon]:[&>svg]:hidden"
        >
          {/* Sin el aro del Avatar de shadcn (`after:border`): con el relleno ya se lee el círculo. */}
          <Avatar className="size-8 rounded-full bg-primary after:hidden">
            <AvatarFallback className="rounded-full bg-primary text-subheadline font-semibold text-primary-foreground">
              {user.initial}
            </AvatarFallback>
          </Avatar>
          <div className="grid flex-1 text-left leading-tight group-data-[collapsible=icon]:hidden">
            <span className="truncate text-subheadline font-medium">
              {user.name || user.email}
            </span>
            {user.email && (
              <span className="truncate text-footnote text-muted-foreground">
                {user.email}
              </span>
            )}
          </div>
          <ChevronsUpDown className="ml-auto size-4 group-data-[collapsible=icon]:hidden" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align="start"
        className="w-56"
        onCloseAutoFocus={() => {
          if (!pendingProfile.current) return
          pendingProfile.current = false
          onProfile?.()
        }}
      >
        <DropdownMenuLabel className="font-normal">
          <div className="grid leading-tight">
            <span className="truncate text-subheadline font-medium">
              {user.name || user.email}
            </span>
            {user.email && (
              <span className="truncate text-footnote text-muted-foreground">
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
