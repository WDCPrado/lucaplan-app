// Reescala una imagen del dispositivo a un data: URL chico, en el navegador y sin librerías.
//
// 768 px de ancho no es arbitrario: es exactamente a lo que OpenAI reduce el lado corto para leer
// una imagen en detalle alto. Mandar la captura de 1170 px original no mejora la lectura ni cambia
// el costo — solo sube 3 MB por el celular del usuario. Subir menos no cuesta nada y no pierde nada.
const MAX_WIDTH = 768
const QUALITY = 0.8

export async function downscaleToDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" })
  try {
    const scale = Math.min(1, MAX_WIDTH / bitmap.width)
    const canvas = document.createElement("canvas")
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    const ctx = canvas.getContext("2d")
    if (!ctx) throw new Error("Canvas no disponible")
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL("image/jpeg", QUALITY)
  } finally {
    bitmap.close()
  }
}
