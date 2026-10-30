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
import { authClient } from "@/lib/auth-client"
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

// La barra inferior no lleva Perfil: en móvil se entra desde Ajustes (su primera fila).
// Ancho relativo de cada pestaña: las etiquetas largas («Recurrentes», «Movimientos») reciben más
// que las cortas, así a 375 px entran completas a 12 px sin cortarse. Bajo 375 px «Movimientos» pasa
// a «Movim.» (`short`), nunca a «…».
const TAB: Partial<Record<NavKey, { weight: number; short?: string }>> = {
  inicio: { weight: 0.8 },
  recurrentes: { weight: 1.2 },
  movimientos: { weight: 1.2, short: "Movim." },
  configuracion: { weight: 0.8 },
}
const BOTTOM_NAV = NAV.filter((n) => n.key !== "perfil").map((n) => ({
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
  children,
}: {
  user: User
  accounts: AccountDTO[]
  categories: CategoryDTO[]
  amountBounds: AmountBoundsDTO
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
  const openSearch = React.useCallback(() => {
    haptic("light")
    setSearchOpen(true)
  }, [])

  async function signOut() {
    await authClient.signOut()
    router.push("/login")
  }

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
      <Chrome
        user={user}
        onSignOut={signOut}
        onSearch={openSearch}
        desktopSlotRef={setDesktopSlot}
        mobileSlotRef={setMobileSlot}
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
    </SlotsContext.Provider>
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
      {children}
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
  onSearch,
  title: titleProp,
  actions,
  desktopSlotRef,
  mobileSlotRef,
  children,
}: Omit<AppShellProps, "actions"> & {
  actions?: React.ReactNode
  onSearch?: () => void
  desktopSlotRef?: (el: HTMLElement | null) => void
  mobileSlotRef?: (el: HTMLElement | null) => void
}) {
  const pathname = usePathname()
  const title =
    titleProp ?? NAV.find((n) => n.key === navKeyOf(pathname))?.label
  const { topRef, endRef, barRef, contentRef, scrolled, atEnd, titleGone } =
    useScrollEdges(pathname)

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
            {user && <UserMenu user={user} onSignOut={onSignOut} />}
          </SidebarFooter>
        </Sidebar>

        <SidebarInset className="min-w-0">
          {/* Marca de "arriba del todo": deja de verse con el primer píxel de scroll. */}
          <div ref={topRef} aria-hidden className="-mb-px h-px" />
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
              <div
                ref={desktopSlotRef}
                className="ml-2 flex items-center empty:hidden"
              >
                {actions}
              </div>
              <div className="ml-auto flex items-center gap-2">
                {/* Búsqueda global: abre el mismo modal que el círculo de la barra móvil. */}
                {onSearch && (
                  <button
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
                  </button>
                )}
              </div>
            </header>
          </div>
          {/* Móvil: controles flotantes en vidrio (iOS 26), sin barra a lo ancho. Con acciones (el
              selector de mes), ocupan todo el ancho; sin ellas, en reposo no hay nada y, cuando el
              título grande se va bajo la fila, aparece al centro una cápsula con el título. El scroll
              edge effect solo aparece cuando hay contenido pasando por debajo de un control (reglas
              en `.top-bar`, globals.css). Solo los controles reciben toques. */}
          <div
            ref={barRef}
            data-scrolled={scrolled || undefined}
            data-title-gone={titleGone || undefined}
            className="top-bar pwa-safe-top pointer-events-none sticky top-0 z-20 scroll-edge-top px-4 pt-2 pb-3 md:hidden"
          >
            <div className="grid min-h-11 w-full items-center *:col-start-1 *:row-start-1">
              <div
                ref={mobileSlotRef}
                data-top-actions
                className="flex w-full min-w-0 *:pointer-events-auto"
              >
                {actions}
              </div>
              {title && (
                <div aria-hidden className="top-title flex min-w-0 justify-center">
                  <div className="liquid-glass flex min-h-11 min-w-0 items-center rounded-full px-4 text-headline font-semibold">
                    <span key={title} className="top-title-text truncate">
                      {title}
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>
          {/* Aire inferior solo en móvil, por la navegación flotante (64px + margen + safe-area). En
              escritorio no flota nada. */}
          <div
            ref={contentRef}
            className="min-w-0 flex-1 pb-[calc(6rem+env(safe-area-inset-bottom))] md:pb-0"
          >
            {children}
          </div>
          {/* Marca del final: visible = ya no queda contenido pasando bajo la barra inferior. */}
          <div ref={endRef} aria-hidden className="-mt-px h-px" />
        </SidebarInset>

        <BottomNav
          active={active}
          onNavigate={onNavigate}
          edge={!atEnd}
          trailing={onSearch && <SearchCircle onSearch={onSearch} />}
        />
      </SidebarProvider>
    </TooltipProvider>
  )
}

// Cuándo hay contenido bajo los controles flotantes, con IntersectionObserver (nada escucha el
// scroll cuadro a cuadro): `scrolled` = la marca de arriba dejó de verse; `atEnd` = se ve la marca
// del final; `titleGone` = el h1 de la vista (el título grande móvil) ya pasó bajo la fila superior.
// El h1 cambia con la ruta, así que su observador se vuelve a enganchar en cada navegación; la barra
// sigue montada.
function useScrollEdges(pathname: string) {
  const topRef = React.useRef<HTMLDivElement>(null)
  const endRef = React.useRef<HTMLDivElement>(null)
  const barRef = React.useRef<HTMLDivElement>(null)
  const contentRef = React.useRef<HTMLDivElement>(null)
  const [scrolled, setScrolled] = React.useState(false)
  const [atEnd, setAtEnd] = React.useState(false)
  const [titleGone, setTitleGone] = React.useState(false)

  React.useEffect(() => {
    const top = topRef.current
    const end = endRef.current
    if (!top || !end) return
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.target === top) setScrolled(!e.isIntersecting)
        else setAtEnd(e.isIntersecting)
      }
    })
    io.observe(top)
    io.observe(end)
    return () => io.disconnect()
  }, [])

  React.useEffect(() => {
    const h1 = contentRef.current?.querySelector("h1")
    if (!h1) return
    // El borde de la ventana se baja al pie de la fila superior: "se fue" = quedó bajo los controles.
    const bar = barRef.current?.offsetHeight ?? 0
    const io = new IntersectionObserver(
      ([e]) =>
        setTitleGone(
          !e.isIntersecting &&
            e.boundingClientRect.bottom <= (e.rootBounds?.top ?? 0)
        ),
      { rootMargin: `-${bar}px 0px 0px 0px` }
    )
    io.observe(h1)
    return () => io.disconnect()
  }, [pathname])

  return { topRef, endRef, barRef, contentRef, scrolled, atEnd, titleGone }
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
  edge,
  trailing,
}: {
  active?: NavKey
  onNavigate?: (key: NavKey) => void
  edge: boolean // hay contenido pasando bajo la barra: se ve el scroll edge effect
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
  // Perfil cuelga de Ajustes en móvil: estando en él, Ajustes queda marcada.
  const current = active ?? optimisticKey
  const activeKey = current === "perfil" ? "configuracion" : current
  const activeIndex = BOTTOM_NAV.findIndex((n) => n.key === activeKey)
  const pill = BOTTOM_NAV[Math.max(activeIndex, 0)]
  const pillLeft = BOTTOM_NAV.slice(0, Math.max(activeIndex, 0)).reduce(
    (sum, n) => sum + n.weight,
    0
  )

  return (
    <div
      className={cn(
        "pointer-events-none fixed inset-x-0 bottom-0 z-30 flex items-center gap-3 scroll-edge-bottom px-4 pt-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] md:hidden",
        !edge && "scroll-edge-off"
      )}
    >
      <nav
        aria-label="Navegación principal"
        className="liquid-glass pointer-events-auto flex h-16 min-w-0 flex-1 rounded-full p-1"
      >
        <div className="relative flex min-w-0 flex-1">
          {/* Las pestañas no miden lo mismo: la pastilla se ubica con left/width en % de la fila
              (es un elemento chico; animarlos no pesa). */}
          <span
            aria-hidden
            className={cn(
              "pointer-events-none absolute inset-y-0 flex transition-[left,width,opacity] duration-[240ms] ease-[cubic-bezier(0.2,0.8,0.2,1)] motion-reduce:transition-none",
              activeIndex < 0 && "opacity-0"
            )}
            style={{
              left: `${(pillLeft / TAB_TOTAL) * 100}%`,
              width: `${(pill.weight / TAB_TOTAL) * 100}%`,
            }}
          >
            <span className="liquid-glass-active w-full rounded-full" />
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
                className={cn(
                  "press relative flex min-w-0 basis-0 flex-col items-center justify-center gap-0.5 rounded-full text-foreground",
                  isActive && "font-semibold"
                )}
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
      {trailing}
    </div>
  )
}

// Menú de la cuenta, solo en el pie del sidebar de escritorio. En móvil lo mismo vive en Ajustes.
function UserMenu({
  user,
  onSignOut,
}: {
  user: User
  onSignOut?: () => void
}) {
  const { resolvedTheme, setTheme } = useTheme()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
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
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-56">
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
