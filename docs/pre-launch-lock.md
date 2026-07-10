# Bloqueo pre-lanzamiento (registro cerrado)

Estado actual: la landing muestra "Próximamente" y **nadie puede crear cuenta**
(bloqueado en front y en backend). El login sigue funcionando para cuentas
existentes entrando directo a `/login`.

Todos los puntos a revertir están marcados con el comentario **`LANZAMIENTO:`**
— para encontrarlos: `grep -rn "LANZAMIENTO:" app arch`.

## Qué se bloqueó y dónde

### 1. Backend — el bloqueo real (1 línea)

[arch/v1/infrastructure/auth/auth.ts](../arch/v1/infrastructure/auth/auth.ts)

```ts
emailAndPassword: { enabled: true, disableSignUp: true },
```

`disableSignUp` es una opción nativa de Better Auth: cualquier intento de
registro (aunque alguien llame a la API directo) responde 400
`EMAIL_PASSWORD_SIGN_UP_DISABLED`. El login de cuentas existentes no se ve
afectado.

**Para lanzar:** borrar `disableSignUp: true` (y el comentario de arriba).

### 2. Login — tab "Crear cuenta" deshabilitado

[app/login/login-form.tsx](../app/login/login-form.tsx)

El `TabsTrigger` de signup tiene `disabled` y un badge "Pronto" (mismo patrón
que el botón de Google). El formulario de registro sigue en el código, solo
quedó inaccesible.

**Para lanzar:** quitar `disabled`, `title` y el `<span>` del badge.

### 3. Landing — CTAs reemplazados por "Próximamente"

[app/page.tsx](../app/page.tsx) — 4 puntos, cada uno con su comentario
`LANZAMIENTO:` que dice exactamente qué restaurar:

| Dónde              | Antes                          | Ahora                        |
| ------------------ | ------------------------------ | ---------------------------- |
| Navbar             | `Entrar` → `/login`            | Pill "Próximamente" (estático) |
| Hero               | `Crear mi plan` → `/login`     | Botón "Próximamente" (estático) |
| CTA final          | `Crear mi plan` → `/login`     | Botón "Próximamente" (estático) |
| Footer (Producto)  | `Entrar` → `/login`            | Texto "Próximamente"         |

**Para lanzar:** restaurar los `<Link href="/login">` que indica cada
comentario (las clases originales con hover están en el historial de git de
este mismo cambio).

## Checklist de lanzamiento

- [ ] `auth.ts`: borrar `disableSignUp: true`
- [ ] `login-form.tsx`: reactivar el tab "Crear cuenta"
- [ ] `page.tsx`: restaurar los 4 links a `/login`
- [ ] Verificar: `grep -rn "LANZAMIENTO:" app arch` no devuelve nada
- [ ] Probar: crear una cuenta nueva de punta a punta
