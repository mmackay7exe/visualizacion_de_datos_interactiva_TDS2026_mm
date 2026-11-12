/* =========================================================
   Ficha de un kami (nivel 2) — reglas_especies.md §4
   - El kami se agranda; sus brazos se separan en cuatro
     cuadrantes por especie y siguen moviéndose según su patrón.
   - Cada brazo lleva una etiqueta: fuente · tipo · int. · patrón.
   - Barra de dB (mín / prom / máx), conteos, lista de sonidos
     y la voz de quien observó (serif).
   Usa la API de campo.js (window.CAMPO) para dibujar el kami
   con exactamente las mismas reglas que en el campo.
   ========================================================= */

(() => {
  const dialogo = document.getElementById("ficha");
  if (!dialogo) return;
  const $ = (id) => document.getElementById(id);
  const canvas = $("ficha-canvas");
  const ctx = canvas.getContext("2d");
  const lienzo = $("ficha-lienzo");
  const rotulos = $("ficha-rotulos");

  const ORDEN = ["Personas", "Tránsito", "Máquinas", "Naturaleza"];
  const TEXTOS = [
    ["situacion_destacada", "Situación destacada"],
    ["hechos", "Hechos"],
    ["interpretacion", "Interpretación"],
    ["bitacora", "Bitácora"],
  ];

  let kami = null;        // kami abierto (objeto preparado por campo.js)
  let recorrido = [];     // ids para anterior / siguiente
  let geo = null;         // geometría actual del dibujo
  let pedido = null, ultimo = null;
  const apagadas = new Set(); // especies silenciadas en el mezclador

  // Proporción del velo: suma de intensidades activas / suma total (reglas §5).
  function proporcionVelo() {
    if (!kami) return 1;
    const int = (s) => s.intensidad ?? 1;
    const total = kami.brazos.reduce((a, { s }) => a + int(s), 0);
    const activa = kami.brazos.filter(({ s }) => !apagadas.has(s.categoria)).reduce((a, { s }) => a + int(s), 0);
    return total ? activa / total : 1;
  }

  // API para mezclador.js
  window.FICHA = {
    kami: () => kami,
    apagadas,
    proporcionVelo,
    redibujar: () => {
      rotulos.querySelectorAll("[data-especie]").forEach((el) =>
        el.classList.toggle("ficha__rotulo--apagado", apagadas.has(el.dataset.especie)));
      dibujar();
      arrancar();
    },
  };

  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const fmt = (n) => n.toLocaleString("es-CL", { maximumFractionDigits: 1 });
  const fecha = (iso) => iso ? iso.split("-").reverse().join("-") : "s/f";
  const n2 = (n) => String(n).padStart(2, "0");

  // ---------- Abrir / cerrar ----------
  function abrir(id) {
    const k = window.CAMPO?.obtener(id);
    if (!k) return;
    kami = k;
    apagadas.clear();
    recorrido = CAMPO.recorrido();
    if (!recorrido.includes(id)) recorrido = [id];
    llenar(k.f);
    if (!dialogo.open) {
      dialogo.showModal();
      document.documentElement.classList.add("ficha-abierta");
      CAMPO.tapar(true);
    }
    dialogo.scrollTop = 0;
    history.replaceState(null, "", "#" + id);
    medir();
    dibujar();
    arrancar();
    document.dispatchEvent(new CustomEvent("ficha-abierta", { detail: id }));
  }

  dialogo.addEventListener("close", () => {
    document.dispatchEvent(new CustomEvent("ficha-cerrada"));
    document.documentElement.classList.remove("ficha-abierta");
    CAMPO.tapar(false);
    detener();
    history.replaceState(null, "", location.pathname + location.search);
    kami = null;
  });
  $("ficha-cerrar").addEventListener("click", () => dialogo.close());

  function mover(paso) {
    if (!kami) return;
    const i = recorrido.indexOf(kami.f.id);
    abrir(recorrido[(i + paso + recorrido.length) % recorrido.length]);
  }
  $("ficha-ant").addEventListener("click", () => mover(-1));
  $("ficha-sig").addEventListener("click", () => mover(1));
  dialogo.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft") { e.preventDefault(); mover(-1); }
    if (e.key === "ArrowRight") { e.preventDefault(); mover(1); }
  });

  document.addEventListener("abrir-ficha", (e) => abrir(e.detail));

  // ---------- Contenido ----------
  function llenar(f) {
    $("ficha-n").textContent = numeroLugar(f.lugar);
    $("ficha-lugar").textContent = f.lugar;
    $("ficha-meta").textContent =
      `${f.id} · ${fecha(f.fecha)} · ${f.hora_inicio}–${f.hora_fin || "?"} · ${f.observador || "s/n"}`;
    const i = recorrido.indexOf(f.id);
    $("ficha-pos").textContent = recorrido.length > 1 ? `${n2(i + 1)} / ${n2(recorrido.length)}` : "";

    barraDb(f);

    const conteos = [
      `${f.peatones_10min ?? "—"} peatones y ${f.vehiculos_10min ?? "—"} vehículos en 10 min`,
      `flujo de personas ${(f.flujo_personas || "s/d").toLowerCase()}, vehicular ${(f.flujo_vehicular || "s/d").toLowerCase()}`,
      `agrado ${f.agrado ?? "s/d"}/5`,
    ];
    if (f.duracion_min && f.duracion_min !== 10)
      conteos.push(`registro de ${f.duracion_min} min, mostrado en el mismo ciclo que los de 10`);
    $("ficha-conteos").textContent = conteos.join(" · ");

    // Lista de sonidos, numerada igual que los rótulos del kami
    $("ficha-sonidos").innerHTML = kami.brazos.map(({ s }, n) => `
      <li>
        <span class="n">${n2(n + 1)}</span>
        <i style="background:${ESPECIES[s.categoria]?.color ?? "var(--linea)"}"></i>
        <span>${esc(s.fuente)}
          <small>${esc(s.categoria)} · tipo ${esc(s.tipo_ficha || "s/d")} · int. ${esc(s.intensidad_texto || "s/d")} · ${esc(s.patron_texto || "patrón sin dato")} · ${esc(s.eventos || "eventos sin dato")}</small>
        </span>
      </li>`).join("");

    // La voz de quien observó
    const textos = TEXTOS.filter(([campo]) => f[campo]?.trim())
      .map(([campo, titulo]) => `<h3>${titulo}</h3><p>${esc(f[campo])}</p>`).join("");
    $("ficha-textos").innerHTML = textos
      ? textos + `<p class="ficha__firma">— ${esc(f.observador || "sin nombre")}</p>`
      : `<p class="mono">Esta ficha no tiene textos anotados.</p>`;

    const rev = $("ficha-revision");
    rev.hidden = !f.notas_revision;
    rev.textContent = f.notas_revision ? `Nota de revisión de los datos: ${f.notas_revision}` : "";
  }

  // Barra de dB: escala propia de la ficha (cubre también valores fuera de 50–80).
  function barraDb(f) {
    const caja = $("ficha-db");
    const valores = [f.db_min, f.db_prom, f.db_max].filter((v) => v != null);
    const lo = Math.min(40, Math.floor(Math.min(...valores) / 10) * 10);
    const hi = Math.max(90, Math.ceil(Math.max(...valores) / 10) * 10);
    const pos = (v) => ((v - lo) / (hi - lo)) * 100;

    let html = `<div class="db-barra__eje"></div>`;
    for (let v = lo; v <= hi; v += 10) html += `<span class="db-barra__tick" style="left:${pos(v)}%">${v}</span>`;
    if (f.db_min != null && f.db_max != null) {
      html += `<div class="db-barra__rango" style="left:${pos(f.db_min)}%;width:${pos(f.db_max) - pos(f.db_min)}%"></div>`;
      html += `<span class="db-barra__marca" style="left:${pos(f.db_min)}%">mín. ${fmt(f.db_min)}</span>`;
      html += `<span class="db-barra__marca" style="left:${pos(f.db_max)}%">máx. ${fmt(f.db_max)}</span>`;
    } else {
      html += `<span class="db-barra__aviso">mín. y máx.: dato incompleto</span>`;
    }
    html += `<span class="db-barra__marca db-barra__marca--prom" style="left:${pos(f.db_prom)}%">${fmt(f.db_prom)} dB</span>`;
    caja.innerHTML = html;
    caja.setAttribute("aria-label", f.db_min != null && f.db_max != null
      ? `Promedio ${fmt(f.db_prom)} dB, mínimo ${fmt(f.db_min)}, máximo ${fmt(f.db_max)}`
      : `Promedio ${fmt(f.db_prom)} dB; mínimo y máximo: dato incompleto`);
  }

  // ---------- Geometría del kami abierto ----------
  function medir() {
    if (!kami) return;
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
    const W = lienzo.clientWidth;
    const conRotulos = W >= 34 * rem;               // en pantallas angostas: solo números
    const H = Math.round(Math.min(Math.max(W * 0.78, 20 * rem), window.innerHeight * 0.68));
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.height = H + "px";

    const cx = W / 2, cy = H / 2;
    const espacioRotulo = conRotulos ? 12.5 * rem : 1.5 * rem;
    const R = Math.max(4 * rem, Math.min(H / 2 - 1.5 * rem, W / 2 - espacioRotulo - 1 * rem));
    const sc = R / 58; // el brazo más largo (43) + su cabeza caben en R

    // Ángulos: cada especie en su cuadrante (Personas arriba a la derecha, luego en sentido horario)
    const porEspecie = {};
    kami.brazos.forEach(({ s }, i) => (porEspecie[s.categoria] ||= []).push(i));
    const angulos = [];
    ORDEN.forEach((e, q) => {
      const idx = porEspecie[e] || [];
      const paso = idx.length > 1 ? Math.min(0.34, 1.25 / (idx.length - 1)) : 0;
      idx.forEach((i, j) => {
        angulos[i] = -Math.PI / 2 + q * (Math.PI / 2) + Math.PI / 4 + (j - (idx.length - 1) / 2) * paso;
      });
    });

    // Puntas de los brazos (posición sin animar) para los rótulos
    const puntas = kami.brazos.map(({ s }, i) => {
      const L = (8 + (s.intensidad ?? 1) * 7) * sc;
      return { i, x: cx + Math.cos(angulos[i]) * L, y: cy + Math.sin(angulos[i]) * L, a: angulos[i], L };
    });

    geo = { W, H, dpr, rem, cx, cy, R, sc, angulos, puntas, conRotulos };
    ubicarRotulos();
  }

  // Rótulos: a cada lado, apilados para que no se monten.
  function ubicarRotulos() {
    const { puntas, cx, R, rem, H, conRotulos } = geo;
    rotulos.innerHTML = "";
    geo.guias = [];

    if (!conRotulos) {
      // solo el número, un poco más allá de la punta
      puntas.forEach((p) => {
        const d = 0.9 * rem;
        const el = document.createElement("span");
        el.className = "ficha__rotulo";
        el.dataset.especie = kami.brazos[p.i].s.categoria;
        el.style.left = p.x + Math.cos(p.a) * d + "px";
        el.style.top = p.y + Math.sin(p.a) * d + "px";
        el.style.transform = "translate(-50%, -50%)";
        el.textContent = n2(p.i + 1);
        rotulos.append(el);
      });
      return;
    }

    const aire = 0.5 * rem;
    for (const lado of ["der", "izq"]) {
      const grupo = puntas.filter((p) => (Math.cos(p.a) >= 0) === (lado === "der")).sort((a, b) => a.y - b.y);
      if (!grupo.length) continue;

      // 1) crear los rótulos para conocer su alto real
      const xRotulo = lado === "der" ? cx + R + 1.25 * rem : cx - R - 1.25 * rem;
      const els = grupo.map((p) => {
        const { s } = kami.brazos[p.i];
        const el = document.createElement("span");
        el.className = `ficha__rotulo ficha__rotulo--${lado}`;
        el.dataset.especie = s.categoria;
        if (lado === "der") el.style.left = xRotulo + "px";
        else el.style.right = geo.W - xRotulo + "px";
        el.innerHTML = `<b><i>${n2(p.i + 1)}</i>${esc(s.fuente)}</b><br>
          <span>${esc(s.tipo_ficha || "s/d")} · int. ${esc(s.intensidad_texto || "s/d")} · ${esc(s.patron_texto || "sin patrón")}</span>`;
        rotulos.append(el);
        return el;
      });
      const h = els.map((el) => el.offsetHeight);

      // 2) apilar cerca de la punta de su brazo, sin montarse
      const ys = grupo.map((p) => p.y);
      const sep = (k) => (h[k - 1] + h[k]) / 2 + aire;
      for (let k = 1; k < ys.length; k++) ys[k] = Math.max(ys[k], ys[k - 1] + sep(k));
      const exceso = ys.at(-1) + h.at(-1) / 2 - H;
      if (exceso > 0) for (let k = 0; k < ys.length; k++) ys[k] -= exceso;
      for (let k = ys.length - 2; k >= 0; k--) ys[k] = Math.min(ys[k], ys[k + 1] - sep(k + 1));
      if (ys[0] - h[0] / 2 < 0) {                    // no caben: se reparten desde arriba
        ys[0] = h[0] / 2;
        for (let k = 1; k < ys.length; k++) ys[k] = ys[k - 1] + sep(k);
      }

      grupo.forEach((p, k) => {
        els[k].style.top = ys[k] + "px";
        geo.guias.push({ x0: p.x, y0: p.y, x1: xRotulo + (lado === "der" ? -0.4 : 0.4) * rem, y1: ys[k] });
      });
    }
  }

  // ---------- Dibujo ----------
  function dibujar() {
    if (!kami || !geo) return;
    const { W, H, dpr, cx, cy, R, sc, angulos } = geo;
    const f = kami.f;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    // Velo: halo borroso; su tamaño depende del dB máximo
    const dbMax = f.db_max ?? f.db_prom;
    const rh = R * (0.55 + 0.45 * limitar((dbMax - 60) / 30, 0, 1));
    const fuera = 10000;
    ctx.save();
    // el velo se aclara al descorrer capas en el mezclador
    ctx.shadowColor = `rgba(30, 28, 26, ${0.16 * proporcionVelo()})`;
    ctx.shadowBlur = R * 0.35 * dpr;
    ctx.shadowOffsetX = fuera * dpr;
    ctx.beginPath(); ctx.arc(cx - fuera, cy, rh, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    // Líneas guía hacia los rótulos
    ctx.save();
    ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue("--tinta-2");
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 0.75;
    ctx.setLineDash([2, 3]);
    (geo.guias || []).forEach((g) => {
      const codo = g.x0 + (g.x1 - g.x0) * 0.55;
      ctx.beginPath(); ctx.moveTo(g.x0, g.y0); ctx.lineTo(codo, g.y1); ctx.lineTo(g.x1, g.y1); ctx.stroke();
    });
    ctx.restore();

    const quieto = CAMPO.sinMovimiento();
    const tc = quieto ? null : CAMPO.tiempo() % CAMPO.CICLO;
    CAMPO.dibujarKami(ctx, { ...kami, x: cx, y: cy }, sc, 1, tc, { angulos, apagadas });

    const reloj = $("ficha-reloj");
    if (quieto) reloj.textContent = "";
    else {
      const seg = Math.floor((tc / CAMPO.CICLO) * 600);
      reloj.textContent = `minuto ${n2(Math.floor(seg / 60))}:${n2(seg % 60)} de 10:00 · cada brazo se enciende cuando ese sonido se oyó`;
    }
  }

  // ---------- Animación ----------
  function cuadro(ahora) {
    pedido = null;
    if (!dialogo.open) return;
    const sonando = window.MEZCLADOR?.sonando();
    if (ultimo != null && !CAMPO.enPausa()) CAMPO.avanzar(Math.min(0.1, (ahora - ultimo) / 1000));
    ultimo = ahora;
    dibujar();
    if (!CAMPO.sinMovimiento() && (!CAMPO.enPausa() || sonando)) pedido = requestAnimationFrame(cuadro);
    else ultimo = null;
  }
  function arrancar() { if (pedido == null) pedido = requestAnimationFrame(cuadro); }
  function detener() { if (pedido != null) cancelAnimationFrame(pedido); pedido = null; ultimo = null; }

  new ResizeObserver(() => { if (dialogo.open) { medir(); dibujar(); } }).observe(lienzo);

  // ---------- Enlace directo: index.html#BP-21 abre esa ficha ----------
  document.addEventListener("datos-listos", async () => {
    const id = decodeURIComponent(location.hash.slice(1));
    if (!/^BP-\d+$/.test(id)) return;
    await document.fonts.ready;
    requestAnimationFrame(() => abrir(id));
  });
})();
