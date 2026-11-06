# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Hoy: Willy y un círculo cercano de dos o tres personas, en uso real y diario. El repo es público:
cualquiera puede levantar su propia instancia, y en cada una el registro se abre con `SIGNUP_OPEN`.

El usuario que el producto persigue es una persona en Chile que administra sus finanzas
personales sobre todo desde el teléfono, recibe las notificaciones de compra de su banco por
correo y necesita entender saldos, cupos, movimientos y presupuestos sin hacer cálculos
manuales.

## Product Purpose

Luca Plan reúne cuentas, tarjetas y movimientos, los categoriza y los convierte en un plan
mensual confiable. El éxito es que el usuario pueda cuadrar su situación financiera real y
saber cuánto tiene disponible hoy.

## Positioning

Dos mecanismos que un producto vecino no podría copiar diciendo lo mismo:

- **Se conecta al correo, no al banco.** Los bancos ya avisan cada compra por email; Luca Plan
  lee solo esas notificaciones con permiso delegado de solo lectura (`Mail.Read`, revocable) y
  convierte cada aviso en un movimiento categorizado. Nunca conoce las claves bancarias y no
  puede mover dinero. No hay agregador bancario detrás.
- **Cada mes parte limpio.** En vez de un saldo acumulado eterno, el presupuesto reinicia cada
  mes y solo la configuración se hereda.

## Operating Context

- El uso principal es móvil, con la app añadida a la pantalla de inicio — condición de las
  notificaciones push en iOS 16.4+. El escritorio es el segundo lugar donde se consulta.
- Los datos entran solos desde las notificaciones de correo del banco (Banco de Chile, Banco
  BICE y MACHBANK —solo débito— vía Outlook / Microsoft Graph). Un mismo correo puede alimentar
  varios bancos.
- Lo que el correo no avisa (saldos, cupos y cargos que el banco no notificó) se corrige desde el
  plugin MCP (WDC-148); los saldos ya no entran por captura.
- El ciclo es mensual: límite global y por categoría, lo no asignado queda "por presupuestar",
  los límites se heredan mes a mes y un selector de mes navega el historial.
- Dos monedas conviven en el mismo instrumento: cupo nacional en CLP y cupo internacional en
  USD. La conversión USD→CLP es referencial, con el dólar observado de mindicador.cl.
- El QA y la revisión visual ocurren en entornos de PR de Railway con datos sembrados; cada
  feature aporta su "escena" con su propio usuario demo.

## Capabilities and Constraints

Reglas de dominio — no son detalles de UI; romper una rompe los números:

- Los saldos y cupos CLP y USD permanecen separados: nunca se mezclan. Los movimientos USD
  entran al plan convertidos a CLP con el dólar observado de su fecha (referencial); sin dólar
  observado quedan fuera de los totales con aviso, nunca con una tasa inventada.
- El gastado del plan es todo gasto real confirmado, con o sin categoría o tope; los topes
  miden categorías y ritmo.
- El titular del Inicio es lo disponible para gastar según lo planificado: lo menor entre el
  margen (ingresos − gastado − comprometido) y lo que queda de los topes. La curva del ritmo
  global reparte lo disponible al inicio del período y no cuenta los pagos de recurrentes ni
  cuotas.
- Sobregiro y cupos de crédito son deuda, no caja disponible.
- Los movimientos internos no consumen presupuesto.
- Lo que se pasó del tope un mes se descuenta del siguiente.

Constraints del sistema:

- En una cuenta conectada los cargos manuales se rechazan: se contarían dos veces cuando llegue
  el correo.
- Ningún dato leído por IA se guarda sin confirmación de la persona: una lectura puede errar un
  dígito y producir un monto perfectamente válido que ninguna validación detecta.
- Los cuerpos de correo se procesan en memoria y nunca se persisten. De cada aviso se conserva
  solo el movimiento (monto, comercio, fecha). El refresh token se guarda cifrado (AES-256-GCM).
- La IA es opcional con degradación segura: sin `OPENAI_API_KEY` la app funciona igual, solo que
  los movimientos quedan sin categorizar y los saldos se escriben a mano.
- Push es Web Push estándar (VAPID), sin tienda ni SDK de terceros: Android, Windows e iOS 16.4+
  instalada.
- Gmail todavía no está soportado; la conexión ya se enruta por proveedor para admitirlo.

Terminología del producto: *cupo nacional* / *cupo internacional*, *por presupuestar*,
*movimiento*, *escena* (los datos de una feature en el entorno de PR).

Sin decidir, y que no debe darse por resuelto: si el producto se abre a un público real y con
qué modelo (hoy no hay ninguno).

## Brand Commitments

- Nombre **Luca Plan**; lema "Este mes sí tiene un plan." Hecho en Chile, español de Chile.
- Voz clara, serena y confiable: habla directo y muestra los datos financieros con precisión,
  sin dramatizar ni decorar información sensible.
- Open source con licencia MIT, repo público.
- Promesa que no se puede romper ni matizar: nunca conoce las claves bancarias, el permiso es de
  solo lectura y revocable, y la app no puede mover dinero.
- Privacidad conforme a la Ley 19.628 y preparada para la Ley 21.719 (Chile).

## Evidence on Hand

- Capturas reales de la app en `docs/images/`: `landing-hero.png`, `app-components.png`,
  `ai-categorization.png`, `email-connection.png`. Se pueden tomar más de la app corriendo.
- Repo público con licencia MIT: <https://github.com/WDCPrado/lucaplan-app>. El código abierto
  es evidencia verificable de las promesas de privacidad y de permiso mínimo.
- Existen métricas de uso reales, pero son de uso propio y del círculo cercano: cualquier cifra
  que se muestre debe declarar esa escala en vez de sugerir adopción masiva.
- **No hay** testimonios de terceros, casos de estudio, prensa ni clientes. No se inventan.

## Product Principles

1. **Un número inventado es peor que un número ausente.** Cuando no alcanza para calcular, se
   deja el dato intacto y se dice qué falta.
2. **Todo lo que leyó una máquina lo confirma la persona** antes de guardarse, y editable en el
   mismo lugar donde después se consulta.
3. **El acceso es el mínimo y es revocable.** Leer correo, nunca mover dinero; y lo que no es el
   movimiento en sí no se guarda.
4. **Cada mes parte limpio:** el plan reinicia, la configuración se hereda.
5. **La IA es una comodidad, no un requisito.** Si falta o falla, la app sigue sirviendo.

## Accessibility & Inclusion

Mantener contraste WCAG AA, foco visible, navegación por teclado, objetivos táctiles cómodos y
soporte para movimiento o transparencia reducidos. Los montos no deben depender solo del color
para comunicar su significado.

---

Las dos secciones que siguen son **dirección visual**, no verdad de producto. Viven aquí porque
el mapa documental del README las ubica en este archivo; si algún día se escribe un `DESIGN.md`,
se mudan ahí.

## Anti-references

- Formularios bancarios genéricos separados de la representación real de la cuenta o tarjeta.
- Interfaces fintech recargadas, con brillo, color o movimiento decorativo.
- Campos monetarios sin formato local o que obligan al usuario a calcular deuda y disponibilidad.
- Etiquetas técnicas usadas como contenido principal, por ejemplo mostrar el tipo de
  notificación en vez del comercio.

## Design Principles

- Mostrar disponibilidad como dato principal y derivar la deuda cuando sea posible.
- Editar los datos en el mismo contexto visual donde después se consultan.
- Usar una sola fuente de formato monetario para cada moneda.
- Mantener separadas las monedas y explicar cualquier estimación.
- Priorizar el flujo móvil, con controles familiares y acciones inequívocas.
