// ==UserScript==
// @name         LucaPlan — Sincronizar Banco de Chile
// @namespace    lucaplan
// @version      1.0.0
// @description  Lee tus cuentas/movimientos desde TU sesión del portal BCH (sin automatización, sin anti-bot) y los envía a tu LucaPlan local.
// @match        https://portalpersonas.bancochile.cl/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @connect      localhost
// @run-at       document-idle
// ==/UserScript==

// CÓMO USAR:
// 1) Instala Tampermonkey (o Violentmonkey) y agrega este userscript.
// 2) En LucaPlan → "Conectar banco" → copia tu token y pégalo cuando el script lo pida (1ª vez).
// 3) Inicia sesión normal en el portal de Banco de Chile.
// 4) Aprieta el botón flotante "⬇ Sincronizar con LucaPlan". Listo: los datos llegan a tu LucaPlan.
// El proceso es de SOLO LECTURA y usa TU sesión (no automatiza el login ni evade nada).

(function () {
  "use strict";
  const BASE = "https://portalpersonas.bancochile.cl/mibancochile/rest/persona";
  const INGEST = GM_getValue("lucaplan_url", "http://localhost:3005") + "/api/bancochile/ingest";
  const EP = {
    saldos: "/bff-pp-prod-ctas-saldos/productos/cuentas/saldos",
    productos: "/selectorproductos/selectorProductos/obtenerProductos?incluirTarjetas=true",
    infoTarjetas: "/tarjetas/widget/informacion-tarjetas",
    getCartola: "/bff-pper-prd-cta-movimientos/movimientos/getCartola",
    tarjetaSaldo: "/tarjeta-credito-digital/saldo/obtener-saldo",
    noFacturados: "/tarjeta-credito-digital/movimientos-no-facturados",
  };

  const jget = (p) => fetch(BASE + p, { headers: { accept: "application/json" }, credentials: "include" }).then((r) => r.json());
  const jpost = (p, d) =>
    fetch(BASE + p, { method: "POST", headers: { accept: "application/json", "content-type": "application/json" }, credentials: "include", body: JSON.stringify(d) }).then((r) => r.json());

  // Lee todo desde la sesión del usuario (mismas llamadas que hace el SPA).
  async function harvest() {
    const productos = await jget(EP.productos);
    const saldos = await jget(EP.saldos);
    const infoTarjetas = await jpost(EP.infoTarjetas, {});
    const prods = (productos && productos.productos) || [];
    const rut = productos && productos.rut;
    const nombre = productos && productos.nombre;
    const cartola = {};
    const tarjetaSaldos = {};
    const noFacturados = {};

    const ctd = prods.find((p) => p.codigo === "CTD");
    if (ctd) {
      const cuentaSeleccionada = {
        nombreCliente: nombre, rutCliente: rut, numero: ctd.numero, mascara: ctd.mascara,
        selected: true, codigoProducto: ctd.codigo, claseCuenta: ctd.claseCuenta, moneda: ctd.codigoMoneda,
      };
      const movs = [];
      for (let page = 1; page <= 40; page++) {
        const r = await jpost(EP.getCartola, { cuentaSeleccionada, cabecera: { statusGenerico: true, paginacionDesde: page } });
        (r.movimientos || []).forEach((m) => movs.push(m));
        if (!r.pagina || !r.pagina[0] || r.pagina[0].masPaginas !== "Y") break;
      }
      cartola[ctd.numero] = movs;
    }

    const info = Array.isArray(infoTarjetas) ? infoTarjetas : [];
    for (const t of prods.filter((p) => p.codigo === "TNM")) {
      const it = info.find((x) => x.idProducto === t.id);
      const payload = { idTarjeta: t.id, codigoProducto: "TNM", tipoTarjeta: it ? it.marca + " " + it.tipo : "", mascara: t.mascara, nombreTitular: nombre, tipoCliente: "T" };
      tarjetaSaldos[t.id] = await jpost(EP.tarjetaSaldo, payload);
      const nf = await jpost(EP.noFacturados, payload);
      noFacturados[t.id] = (nf && nf.listaMovNoFactur) || [];
    }

    return { saldos, productos, infoTarjetas, tarjetaSaldos, cartola, noFacturados };
  }

  function token() {
    let t = GM_getValue("lucaplan_token", "");
    if (!t) {
      t = prompt("Pega tu token de LucaPlan (LucaPlan → Conectar banco → Copiar token):") || "";
      if (t) GM_setValue("lucaplan_token", t.trim());
    }
    return t.trim();
  }

  function send(data, btn) {
    GM_xmlhttpRequest({
      method: "POST",
      url: INGEST,
      headers: { "content-type": "application/json" },
      data: JSON.stringify({ token: token(), data }),
      onload: (res) => {
        try {
          const j = JSON.parse(res.responseText);
          if (res.status >= 200 && res.status < 300) btn.textContent = `✓ ${j.accounts ?? 0} cuentas, ${j.cartolaMovements ?? 0} movs`;
          else if (res.status === 401) { GM_setValue("lucaplan_token", ""); btn.textContent = "✗ token inválido (reintenta)"; }
          else btn.textContent = "✗ " + (j.error || res.status);
        } catch { btn.textContent = "✗ error " + res.status; }
        reset(btn);
      },
      onerror: () => { btn.textContent = "✗ ¿LucaPlan abierto en localhost?"; reset(btn); },
    });
  }

  function reset(btn) {
    setTimeout(() => { btn.textContent = LABEL; btn.disabled = false; }, 4000);
  }

  const LABEL = "⬇ Sincronizar con LucaPlan";
  function mountButton() {
    if (document.getElementById("lucaplan-sync-btn")) return;
    const btn = document.createElement("button");
    btn.id = "lucaplan-sync-btn";
    btn.textContent = LABEL;
    btn.style.cssText =
      "position:fixed;right:16px;bottom:16px;z-index:2147483647;padding:12px 16px;border-radius:9999px;border:none;" +
      "background:#2563eb;color:#fff;font:600 14px system-ui;cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,.25)";
    btn.onclick = async () => {
      if (!token()) return;
      btn.disabled = true;
      btn.textContent = "Leyendo tus datos…";
      try {
        const data = await harvest();
        btn.textContent = "Enviando a LucaPlan…";
        send(data, btn);
      } catch (e) {
        btn.textContent = "✗ error leyendo (¿sesión activa?)";
        reset(btn);
      }
    };
    document.body.appendChild(btn);
  }

  const iv = setInterval(() => { if (document.body) { mountButton(); clearInterval(iv); } }, 500);
})();
