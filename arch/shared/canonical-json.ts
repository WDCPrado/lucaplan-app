// JSON canónico: mismas claves en orden alfabético a cualquier profundidad. Dos objetos con los
// mismos datos dan el mismo texto aunque sus claves vengan en otro orden; sirve para comparar o
// firmar un estado (hash de argumentos de una operación, estado de una cuenta antes de borrarla).
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  if (value !== null && typeof value === "object") {
    const object = value as Record<string, unknown>
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
      .join(",")}}`
  }
  return JSON.stringify(value)
}
