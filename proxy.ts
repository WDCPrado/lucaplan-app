import { NextResponse, type NextRequest } from "next/server"
import { getSessionCookie } from "better-auth/cookies"

// Gating de auth server-side (Next 16: convención `proxy`, antes `middleware`).
// Chequeo optimista de cookie en el edge; la validación real de sesión la hace cada
// server component / use-case. Rutas públicas: solo /login.
const PUBLIC_ROUTES = ["/", "/login"]

// Deploy landing-only (ej. Railway como vitrina del proyecto open source):
// con NEXT_PUBLIC_LANDING_ONLY=true existen la landing y /login (sin registro —
// auth.ts cierra el sign-up); sin sesión, el resto de rutas vuelve a / en vez de /login.
const LANDING_ONLY = process.env.NEXT_PUBLIC_LANDING_ONLY === "true"

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  const isPublicAsset = /\.[^/]+$/.test(pathname)

  if (
    LANDING_ONLY &&
    !isPublicAsset &&
    !PUBLIC_ROUTES.includes(pathname) &&
    !getSessionCookie(request)
  ) {
    return NextResponse.redirect(new URL("/", request.url))
  }
  const isPublic =
    isPublicAsset ||
    PUBLIC_ROUTES.some((p) => pathname === p || pathname.startsWith(`${p}/`))

  // Solo el caso optimista: sin cookie en ruta protegida → al login.
  // NO redirigimos /login→/ por cookie: la cookie puede estar viva pero la sesión inválida,
  // y eso se trenzaría con la validación real de la home → bucle (ERR_TOO_MANY_REDIRECTS).
  // El redirect del usuario autenticado fuera de /login se hace server-side (sesión real).
  if (!isPublic && !getSessionCookie(request)) {
    return NextResponse.redirect(new URL("/login", request.url))
  }
  return NextResponse.next()
}

export const config = {
  // Toda la app salvo: /api (incluye /api/auth), assets de Next y favicon.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
}
