"use client";

import { useCallback, useRef } from "react";

// Arrastrar-para-scrollear horizontal con el mouse (en touch el scroll ya es nativo, así que
// solo interceptamos punteros de tipo mouse). Devuelve el ref del contenedor y los handlers.
export function useDragScroll() {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef({ active: false, startX: 0, startLeft: 0 });

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    const el = ref.current;
    if (!el || e.pointerType !== "mouse") return;
    drag.current = { active: true, startX: e.clientX, startLeft: el.scrollLeft };
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const el = ref.current;
    if (!el || !drag.current.active) return;
    el.scrollLeft = drag.current.startLeft - (e.clientX - drag.current.startX);
  }, []);

  const stop = useCallback(() => {
    drag.current.active = false;
  }, []);

  return {
    ref,
    handlers: { onPointerDown, onPointerMove, onPointerUp: stop, onPointerLeave: stop },
  };
}
