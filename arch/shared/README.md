# shared

Código **puro y sin negocio**, cross-version. No conoce ninguna capa (`domain`,
`application`, `infrastructure`, `presentation`). No importa de `arch/v1/`.

- `http/` — helpers HTTP genéricos.
- `utils/` — utilidades puras.

Si algo tiene reglas de negocio, no va aquí: va al `_shared/` de la capa que corresponda.
