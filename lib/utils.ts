import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

// La escala tipográfica de iOS (globals.css, `--text-*`) son tamaños: sin esto tailwind-merge
// leería `text-body` como un color y lo borraría al lado de `text-primary`.
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: [
        "large-title",
        "hero",
        "title-1",
        "title-3",
        "headline",
        "body",
        "subheadline",
        "footnote",
        "caption",
      ],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
