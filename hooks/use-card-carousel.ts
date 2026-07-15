"use client";

import { useCallback, useEffect, useRef } from "react";
import { useDragScroll } from "./use-drag-scroll";
import { haptic } from "@/lib/haptics";

// Carrusel de tarjetas (dashboard y landing): drag con mouse + fade dinámico en los bordes
// (aparece a la izquierda al scrollear, desaparece a la derecha al llegar al final) y, en móvil,
// zoom estilo wallet según distancia al centro con un haptic ligero al cambiar la tarjeta activa.
// Los ítems se marcan con [data-card]; el contenedor lleva la mask con --fade-l/--fade-r.
export function useCardCarousel() {
  const { ref, handlers } = useDragScroll();
  const raf = useRef(0);
  const active = useRef(-1);

  const update = useCallback((el: HTMLElement) => {
    el.style.setProperty("--fade-l", el.scrollLeft > 8 ? "2.5rem" : "0rem");
    el.style.setProperty(
      "--fade-r",
      el.scrollLeft < el.scrollWidth - el.clientWidth - 8 ? "2.5rem" : "0rem"
    );
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => {
      // Solo los ítems marcados: un overlay puede colarse como hijo directo.
      const children = Array.from(
        el.querySelectorAll<HTMLElement>(":scope > [data-card]")
      );
      if (window.innerWidth >= 1024) {
        // Escritorio: snap-start sin zoom; limpia escalas residuales (p. ej. tras rotar tablet).
        for (const child of children) child.style.transform = "";
        active.current = -1;
        return;
      }
      const viewCenter = el.scrollLeft + el.clientWidth / 2;
      let nearest = -1;
      let best = Infinity;
      children.forEach((child, i) => {
        // offsetLeft/offsetWidth son de layout: inmunes al scroll y al propio scale.
        const center = child.offsetLeft - el.offsetLeft + child.offsetWidth / 2;
        const dist = Math.abs(center - viewCenter);
        child.style.transform = `scale(${1 - 0.07 * Math.min(1, dist / el.clientWidth)})`;
        if (dist < best) {
          best = dist;
          nearest = i;
        }
      });
      if (nearest !== active.current) {
        if (active.current !== -1) haptic("light"); // no vibrar en el montaje
        active.current = nearest;
      }
    });
  }, []);

  // Zoom/fade inicial: dependen de medidas del DOM, así que se aplican tras montar.
  useEffect(() => {
    if (ref.current) update(ref.current);
  }, [ref, update]);

  return {
    ref,
    handlers,
    onScroll: (e: React.UIEvent<HTMLElement>) => update(e.currentTarget),
  };
}
