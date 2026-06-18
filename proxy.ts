import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

// Gating de auth server-side (Next 16: convención `proxy`, antes `middleware`).
// Chequeo optimista de cookie en el edge; la validación real de sesión va en el
// server component / use-case. Extiende el matcher con las rutas que protejas.
export function proxy(request: NextRequest) {
  const sessionCookie = getSessionCookie(request);
  if (!sessionCookie) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*"],
};
