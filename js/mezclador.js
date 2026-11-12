/* =========================================================
   Mezclador de la ficha (nivel 3) — reglas_especies.md §5
   - Cuatro láminas translúcidas, una por especie: se descorren
     (silencian) y vuelven.
   - El velo responde: su opacidad = base × (intensidades activas / total).
     También el sonido: con menos velo suena más claro y cercano.
   - El audio lo hace motor-audio.js (window.MOTOR).
   ========================================================= */

(() => {
  const $ = (id) => document.getElementById(id);
  const info = $("ficha-info");
  const panel = $("ficha-mezclador");
  if (!panel) return;

  const ORDEN = ["Personas", "Tránsito", "Máquinas", "Naturaleza"];
  const fmt = (n) => n.toLocaleString("es-CL", { maximumFractionDigits: 1 }).replace("-", "−");

  // Densidad del velo sonoro según el nivel del momento (más dB, velo más denso)
  const densidad = (db) => 0.35 + 0.65 * limitar((db - 50) / 30, 0, 1);

  // ---------- Panel ----------
  function abrirPanel() {
    info.hidden = true;
    panel.hidden = false;
    construir();
    panel.closest(".ficha")?.scrollTo({ top: 0 });
  }
  function cerrarPanel() {
    detener();
    FICHA.apagadas.clear();
    FICHA.redibujar();
    panel.hidden = true;
    info.hidden = false;
  }
  $("ficha-mezclar").addEventListener("click", abrirPanel);
  $("mezclador-volver").addEventListener("click", cerrarPanel);

  // Llevar este kami a la mesa de mezcla libre (mesa.js)
  $("mezclador-mesa")?.addEventListener("click", () => {
    const k = FICHA.kami();
    if (!k) return;
    detener();
    $("ficha").close();
    document.dispatchEvent(new CustomEvent("mesa-cargar", { detail: k.f.id }));
  });

  document.addEventListener("ficha-abierta", () => {
    detener();
    if (!panel.hidden) construir();
  });
  document.addEventListener("ficha-cerrada", () => {
    detener();
    panel.hidden = true;
    info.hidden = false;
  });

  function construir() {
    const k = FICHA.kami();
    if (!k) return;
    const int = (s) => s.intensidad ?? 1;
    const total = k.brazos.reduce((a, { s }) => a + int(s), 0) || 1;

    $("mezclador-laminas").innerHTML = ORDEN.map((e) => {
      const sonidos = k.brazos.filter(({ s }) => s.categoria === e);
      const suma = sonidos.reduce((a, { s }) => a + int(s), 0);
      const n = sonidos.length;
      const cifras = n
        ? `${n} ${n === 1 ? "sonido" : "sonidos"} · intensidad sumada ${fmt(suma)} · ${sonidos.map(({ s }) => s.fuente).join(", ")}`
        : "no se oyó en este momento";
      return `<button class="lamina-capa" type="button" data-especie="${e}" style="--c:${ESPECIES[e].color}"
                aria-pressed="${n ? "true" : "false"}" ${n ? "" : "disabled"}>
          <span class="lamina-capa__nombre">${e}</span>
          <span class="lamina-capa__estado">${n ? "suena" : "—"}</span>
          <span class="lamina-capa__cifras">${cifras}</span>
          <span class="lamina-capa__peso"><i style="width:${(suma / total) * 100}%"></i></span>
        </button>`;
    }).join("");

    $("mezclador-volumen").textContent =
      `Volumen general según ${fmt(k.f.db_prom)} dB promedio: ${fmt(MOTOR.dbGeneral(k.f.db_prom))} dB (54 dB → −18 · 78 dB → 0).`;
    actualizarVelo();
    actualizarEstado();
  }

  $("mezclador-laminas").addEventListener("click", (ev) => {
    const b = ev.target.closest(".lamina-capa");
    if (!b || b.disabled) return;
    const e = b.dataset.especie;
    const suena = b.getAttribute("aria-pressed") === "true";
    b.setAttribute("aria-pressed", String(!suena));
    b.querySelector(".lamina-capa__estado").textContent = suena ? "descorrida" : "suena";
    if (suena) FICHA.apagadas.add(e); else FICHA.apagadas.delete(e);
    FICHA.redibujar();
    actualizarVelo();
  });

  function actualizarVelo() {
    const k = FICHA.kami();
    if (!k) return;
    const p = FICHA.proporcionVelo();
    $("mezclador-velo-barra").style.width = p * 100 + "%";
    const quedan = k.brazos.filter(({ s }) => !FICHA.apagadas.has(s.categoria)).length;
    $("mezclador-velo").textContent = p >= 1
      ? `Velo completo: los ${k.brazos.length} sonidos del momento.`
      : quedan === 0
        ? "Sin velo: todas las láminas están descorridas; queda el lugar en silencio."
        : `El velo se aclara: quedan ${quedan} de ${k.brazos.length} sonidos, y se oyen más cerca.`;
  }

  async function actualizarEstado() {
    const k = FICHA.kami();
    if (!k) return;
    const familias = [...new Set(k.brazos.map(({ s }) => s.familia_sonido).filter(Boolean))];
    const { con, faltan } = await MOTOR.resumenArchivos(familias);
    if (FICHA.kami() !== k) return;
    $("mezclador-estado").textContent = !con.length
      ? `Todavía no hay archivos de audio: el mezclador funciona en silencio. Faltan en assets/audio/: ${faltan.map((f) => f + ".mp3").join(", ")}.`
      : faltan.length
        ? `Suenan ${con.length} de ${familias.length} familias. Faltan: ${faltan.map((f) => f + ".mp3").join(", ")}.`
        : `Las ${familias.length} familias de sonido de este momento tienen audio.`;
  }

  // ---------- Audio ----------
  const boton = $("mezclador-sonar");
  boton.addEventListener("click", () => (MOTOR.kamiSonando() === FICHA.kami() ? detener() : sonar()));

  async function sonar() {
    const k = FICHA.kami();
    if (!k) return;
    const ok = await MOTOR.sonar(k, {
      apagadas: () => FICHA.apagadas,
      velo: () => densidad(k.f.db_prom) * FICHA.proporcionVelo(),
    });
    if (!ok) { $("mezclador-estado").textContent = "Este navegador no permite reproducir audio."; return; }
    boton.setAttribute("aria-pressed", "true");
    boton.textContent = "■ Detener";
    FICHA.redibujar();
  }

  function detener() {
    if (MOTOR.kamiSonando() === FICHA.kami() || !FICHA.kami()) MOTOR.detener();
    boton.setAttribute("aria-pressed", "false");
    boton.textContent = "▶ Escuchar";
  }

  window.MEZCLADOR = { sonando: () => MOTOR.sonando() };
})();
