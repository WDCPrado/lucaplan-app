import type { ReactNode } from "react"

// Textos legales de Luca Plan (borrador base alineado a la Ley 21.719 de Protección de
// Datos Personales de Chile). Revisar con asesoría legal antes del lanzamiento comercial.

function H(props: { children: ReactNode }) {
  return (
    <h3 className="pt-2 font-semibold text-foreground">{props.children}</h3>
  )
}

const UPDATED = "Última actualización: julio de 2026"

export const LEGAL = {
  terminos: {
    title: "Términos y Condiciones",
    body: (
      <div className="space-y-4 text-sm leading-6 text-muted-foreground">
        <p className="text-xs">{UPDATED}</p>
        <p>
          Estos Términos y Condiciones regulan el uso de Luca Plan, una
          aplicación web de planificación de finanzas personales, en su servicio
          hospedado en lucaplan.cl. Al crear una cuenta o usar el servicio,
          aceptas estos términos. El código fuente de Luca Plan es open source
          bajo licencia MIT: si instalas y ejecutas tu propia instancia, esa
          licencia — y no estos términos — rige ese uso.
        </p>
        <H>1. El servicio</H>
        <p>
          Luca Plan te permite organizar presupuestos mensuales, registrar
          movimientos y conectar cuentas bancarias en modalidad de solo lectura.
          Luca Plan es una herramienta informativa: no mueve dinero, no ejecuta
          pagos ni transferencias, y no constituye asesoría financiera,
          tributaria ni de inversión.
        </p>
        <H>2. Tu cuenta</H>
        <p>
          Eres responsable de mantener la confidencialidad de tus credenciales y
          de la actividad que ocurra en tu cuenta. Debes entregar información
          veraz y mantenerla actualizada.
        </p>
        <H>3. Conexión por correo</H>
        <p>
          La información bancaria se obtiene desde las notificaciones que tu
          banco envía a tu correo electrónico. Al conectar tu cuenta de correo
          (por ejemplo, Outlook o Gmail, según los proveedores disponibles en la
          aplicación) autorizas a Luca Plan un permiso delegado de solo lectura,
          que puedes revocar en cualquier momento desde la cuenta de tu
          proveedor de correo o desconectando el banco en la aplicación. Luca
          Plan procesa únicamente los mensajes de remitentes conocidos de tu
          banco, nunca recibe ni almacena tus claves bancarias, no puede enviar,
          mover ni eliminar correos, y no puede operar sobre tus cuentas.
        </p>
        <H>4. Categorización con IA</H>
        <p>
          Luca Plan puede clasificar automáticamente tus movimientos usando
          inteligencia artificial. Esta clasificación es una sugerencia y puede
          contener errores; siempre puedes corregirla. Las decisiones
          financieras que tomes a partir de la información mostrada son de tu
          exclusiva responsabilidad.
        </p>
        <H>5. Propiedad intelectual</H>
        <p>
          El código fuente de Luca Plan es open source y se distribuye bajo la
          licencia MIT. El nombre, la marca, el diseño y los contenidos del
          servicio hospedado en lucaplan.cl son de propiedad de sus titulares;
          el uso del servicio no te otorga derechos sobre ellos más allá del
          derecho de uso personal de la aplicación.
        </p>
        <H>6. Disponibilidad y cambios</H>
        <p>
          El servicio se presta &quot;tal cual&quot; y puede experimentar
          interrupciones, mantenciones o cambios de funcionalidades. Podemos
          actualizar estos términos; los cambios relevantes se informarán dentro
          de la aplicación.
        </p>
        <H>7. Limitación de responsabilidad</H>
        <p>
          En la medida permitida por la ley chilena, Luca Plan no responde por
          perjuicios derivados de decisiones tomadas con base en la información
          mostrada, errores de categorización, ni por indisponibilidad del
          servicio o retrasos en la recepción de las notificaciones bancarias de
          tu correo.
        </p>
        <H>8. Término</H>
        <p>
          Puedes cerrar tu cuenta en cualquier momento; al hacerlo se eliminarán
          tus datos conforme a la Política de Privacidad. Podremos suspender
          cuentas que infrinjan estos términos o la ley.
        </p>
        <H>9. Ley aplicable</H>
        <p>
          Estos términos se rigen por las leyes de la República de Chile.
          Cualquier controversia será conocida por los tribunales ordinarios de
          justicia chilenos.
        </p>
      </div>
    ),
  },
  privacidad: {
    title: "Política de Privacidad",
    body: (
      <div className="space-y-4 text-sm leading-6 text-muted-foreground">
        <p className="text-xs">{UPDATED}</p>
        <p>
          Esta política describe cómo Luca Plan trata tus datos personales,
          conforme a la Ley N.º 19.628 sobre Protección de la Vida Privada y a
          la Ley N.º 21.719 de Protección de Datos Personales de Chile (en
          vigencia desde diciembre de 2026), a cuyo estándar esta política ya se
          anticipa.
        </p>
        <H>1. Responsable del tratamiento</H>
        <p>
          Luca Plan actúa como responsable del tratamiento de los datos
          personales que entregas al usar la aplicación. Puedes contactarnos
          para cualquier asunto de privacidad a través del correo indicado en la
          aplicación.
        </p>
        <H>2. Qué datos tratamos</H>
        <p>
          (a) Datos de cuenta: nombre y correo electrónico. (b) Datos
          financieros: los movimientos y saldos que se extraen de las
          notificaciones bancarias de tu correo que autorizas a leer, y los
          movimientos, categorías y presupuestos que registras manualmente. El
          contenido de los correos se procesa en memoria y no se almacena; solo
          se guarda el evento financiero extraído (monto, fecha, comercio e
          instrumento). (c) Datos de uso: preferencias y correcciones de
          categorización, que se usan para mejorar la clasificación de tus
          propios movimientos.
        </p>
        <H>3. Finalidad y base de licitud</H>
        <p>
          Tratamos tus datos exclusivamente para prestarte el servicio: mostrar
          tus finanzas, calcular presupuestos y categorizar movimientos. La base
          de licitud es la ejecución del contrato (estos términos) y tu
          consentimiento, que otorgas al conectar cada banco y que puedes
          revocar desconectándolo en cualquier momento.
        </p>
        <H>4. Encargados y terceros</H>
        <p>
          (a) Conexión por correo: interviene el proveedor de tu buzón —
          Microsoft (Microsoft Graph) para cuentas Outlook y, cuando esté
          disponible, Google para cuentas Gmail —; Luca Plan accede con un
          permiso delegado de solo lectura y guarda el token de acceso cifrado
          en el servidor. Tus claves bancarias nunca se solicitan ni se
          transmiten. (b) Proveedor de IA: para categorizar, se envían
          descripciones y montos de movimientos, junto a los nombres y
          descripciones de tus categorías; no se envían tus credenciales ni
          identificadores bancarios. No vendemos tus datos ni los usamos para
          publicidad.
        </p>
        <H>5. Conservación y supresión</H>
        <p>
          Conservamos tus datos mientras mantengas tu cuenta. Al desconectar un
          banco se eliminan sus cuentas y movimientos asociados; al cerrar tu
          cuenta se eliminan tus datos personales, salvo aquellos que debamos
          conservar por obligación legal.
        </p>
        <H>6. Tus derechos</H>
        <p>
          Puedes ejercer los derechos de acceso, rectificación, supresión y
          oposición que reconoce la Ley 19.628 y, desde la entrada en vigencia
          de la Ley 21.719, también la portabilidad de tus datos; asimismo
          puedes revocar tu consentimiento sin efecto retroactivo. Podrás además
          reclamar ante la Agencia de Protección de Datos Personales una vez que
          entre en funciones (diciembre de 2026).
        </p>
        <H>7. Seguridad</H>
        <p>
          Aplicamos medidas técnicas y organizativas razonables: cifrado en
          tránsito, token de acceso al correo cifrado en reposo (AES-256-GCM) y
          eliminado al desconectar el banco, cuerpos de correo no persistidos, y
          sesiones protegidas. Ningún sistema es infalible; te notificaremos las
          brechas de seguridad que la ley exija informar.
        </p>
        <H>8. Cambios</H>
        <p>
          Si modificamos esta política de forma relevante, te lo informaremos
          dentro de la aplicación antes de que los cambios entren en vigencia.
        </p>
      </div>
    ),
  },
} as const

export type LegalKey = keyof typeof LEGAL
