import type { ReactNode } from "react"

// Textos legales de LucaPlan (borrador base alineado a la Ley 21.719 de Protección de
// Datos Personales de Chile). Revisar con asesoría legal antes del lanzamiento comercial.

function H(props: { children: ReactNode }) {
  return <h3 className="pt-2 font-semibold text-foreground">{props.children}</h3>
}

const UPDATED = "Última actualización: julio de 2026"

export const LEGAL = {
  terminos: {
    title: "Términos y Condiciones",
    body: (
      <div className="space-y-4 text-sm leading-6 text-muted-foreground">
        <p className="text-xs">{UPDATED}</p>
        <p>
          Estos Términos y Condiciones regulan el uso de LucaPlan, una
          aplicación web de planificación de finanzas personales. Al crear una
          cuenta o usar el servicio, aceptas estos términos.
        </p>
        <H>1. El servicio</H>
        <p>
          LucaPlan te permite organizar presupuestos mensuales, registrar
          movimientos y conectar cuentas bancarias en modalidad de solo
          lectura. LucaPlan es una herramienta informativa: no mueve dinero,
          no ejecuta pagos ni transferencias, y no constituye asesoría
          financiera, tributaria ni de inversión.
        </p>
        <H>2. Tu cuenta</H>
        <p>
          Eres responsable de mantener la confidencialidad de tus credenciales
          y de la actividad que ocurra en tu cuenta. Debes entregar
          información veraz y mantenerla actualizada.
        </p>
        <H>3. Conexión bancaria</H>
        <p>
          La conexión con instituciones financieras se realiza mediante un
          conector de código abierto (open source) que se ejecuta de forma
          local, en tu propio equipo, y está destinado exclusivamente a uso
          personal y local. Tú inicias sesión directamente en el sitio de tu
          banco; LucaPlan accede únicamente a información de cuentas y
          movimientos en modo lectura, nunca recibe ni almacena tus claves
          bancarias, y no puede operar sobre tus cuentas.
        </p>
        <H>4. Categorización con IA</H>
        <p>
          LucaPlan puede clasificar automáticamente tus movimientos usando
          inteligencia artificial. Esta clasificación es una sugerencia y
          puede contener errores; siempre puedes corregirla. Las decisiones
          financieras que tomes a partir de la información mostrada son de tu
          exclusiva responsabilidad.
        </p>
        <H>5. Propiedad intelectual</H>
        <p>
          El software, marca, diseño y contenidos de LucaPlan son de
          propiedad de sus titulares. El uso del servicio no te otorga
          licencia alguna sobre ellos, salvo el derecho de uso personal e
          intransferible de la aplicación.
        </p>
        <H>6. Disponibilidad y cambios</H>
        <p>
          El servicio se presta &quot;tal cual&quot; y puede experimentar
          interrupciones, mantenciones o cambios de funcionalidades. Podemos
          actualizar estos términos; los cambios relevantes se informarán
          dentro de la aplicación.
        </p>
        <H>7. Limitación de responsabilidad</H>
        <p>
          En la medida permitida por la ley chilena, LucaPlan no responde por
          perjuicios derivados de decisiones tomadas con base en la
          información mostrada, errores de categorización, ni por
          indisponibilidad del servicio o del conector bancario local.
        </p>
        <H>8. Término</H>
        <p>
          Puedes cerrar tu cuenta en cualquier momento; al hacerlo se
          eliminarán tus datos conforme a la Política de Privacidad. Podremos
          suspender cuentas que infrinjan estos términos o la ley.
        </p>
        <H>9. Ley aplicable</H>
        <p>
          Estos términos se rigen por las leyes de la República de Chile.
          Cualquier controversia será conocida por los tribunales ordinarios
          de justicia chilenos.
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
          Esta política describe cómo LucaPlan trata tus datos personales,
          conforme a la Ley N.º 21.719 de Protección de Datos Personales de
          Chile.
        </p>
        <H>1. Responsable del tratamiento</H>
        <p>
          LucaPlan actúa como responsable del tratamiento de los datos
          personales que entregas al usar la aplicación. Puedes contactarnos
          para cualquier asunto de privacidad a través del correo indicado en
          la aplicación.
        </p>
        <H>2. Qué datos tratamos</H>
        <p>
          (a) Datos de cuenta: nombre y correo electrónico. (b) Datos
          financieros: cuentas, saldos y movimientos bancarios que autorizas a
          leer mediante el conector open source que se ejecuta localmente en
          tu equipo, y los movimientos, categorías y presupuestos que
          registras manualmente. (c) Datos de uso: preferencias y
          correcciones de categorización, que se usan para mejorar la
          clasificación de tus propios movimientos.
        </p>
        <H>3. Finalidad y base de licitud</H>
        <p>
          Tratamos tus datos exclusivamente para prestarte el servicio:
          mostrar tus finanzas, calcular presupuestos y categorizar
          movimientos. La base de licitud es la ejecución del contrato (estos
          términos) y tu consentimiento, que otorgas al conectar cada banco y
          que puedes revocar desconectándolo en cualquier momento.
        </p>
        <H>4. Encargados y terceros</H>
        <p>
          (a) Conexión bancaria: no interviene ningún proveedor externo; el
          conector open source corre localmente en tu equipo, por lo que tus
          claves y tu sesión bancaria nunca llegan a servidores de LucaPlan
          ni de terceros. (b) Proveedor de IA: para categorizar, se
          envían descripciones y montos de movimientos, junto a los nombres y
          descripciones de tus categorías; no se envían tus credenciales ni
          identificadores bancarios. No vendemos tus datos ni los usamos para
          publicidad.
        </p>
        <H>5. Conservación y supresión</H>
        <p>
          Conservamos tus datos mientras mantengas tu cuenta. Al desconectar
          un banco se eliminan sus cuentas y movimientos asociados; al cerrar
          tu cuenta se eliminan tus datos personales, salvo aquellos que
          debamos conservar por obligación legal.
        </p>
        <H>6. Tus derechos</H>
        <p>
          Conforme a la Ley 21.719 puedes ejercer los derechos de acceso,
          rectificación, supresión, oposición y portabilidad de tus datos, y
          a revocar tu consentimiento sin efecto retroactivo. También puedes
          reclamar ante la Agencia de Protección de Datos Personales.
        </p>
        <H>7. Seguridad</H>
        <p>
          Aplicamos medidas técnicas y organizativas razonables: cifrado en
          tránsito, sesión bancaria que permanece únicamente en tu equipo (y
          que puedes eliminar al desconectar el banco), y sesiones protegidas.
          Ningún sistema es infalible; te
          notificaremos las brechas de seguridad que la ley exija informar.
        </p>
        <H>8. Cambios</H>
        <p>
          Si modificamos esta política de forma relevante, te lo informaremos
          dentro de la aplicación antes de que los cambios entren en
          vigencia.
        </p>
      </div>
    ),
  },
} as const

export type LegalKey = keyof typeof LEGAL
