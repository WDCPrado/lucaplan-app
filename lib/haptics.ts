"use client";

// Haptic feedback web: Android vibra con navigator.vibrate; iOS Safari no lo expone,
// pero desde iOS 18 el toggle de un <input type="checkbox" switch> dispara el háptico
// del sistema — clickear su <label> programáticamente lo reproduce. En escritorio es no-op.
let iosLabel: HTMLLabelElement | null = null;

function iosHaptic() {
  if (!iosLabel) {
    iosLabel = document.createElement("label");
    iosLabel.ariaHidden = "true";
    iosLabel.style.display = "none";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.setAttribute("switch", "");
    iosLabel.appendChild(input);
    document.body.appendChild(iosLabel);
  }
  iosLabel.click();
}

const PATTERNS: Record<"light" | "medium" | "heavy", number | number[]> = {
  light: 10,
  medium: 25,
  heavy: [30, 40, 30],
};

export function haptic(style: keyof typeof PATTERNS = "light") {
  if (typeof window === "undefined") return;
  try {
    // vibrate() devuelve false si el patrón es inválido; si no existe (iOS), va al hack.
    if (!navigator.vibrate?.(PATTERNS[style])) iosHaptic();
  } catch {
    // ponytail: sin haptics no se rompe nada — silencio deliberado
  }
}
