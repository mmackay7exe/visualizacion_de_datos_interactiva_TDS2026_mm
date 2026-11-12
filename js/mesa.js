/* =========================================================
   Mesa de mezcla — el usuario arma su propio kami
   - Por especie: cantidad de sonidos (0–5), intensidad (1–5)
     y ritmo (puntual · intermitente · continuo).
   - Nivel del lugar (dB promedio 50–80): volumen y densidad del velo.
   - El kami se dibuja y suena con las mismas reglas que los registrados
     (CAMPO.prepararKami + MOTOR).
   - Se compara con los kamis registrados y se muestra el más parecido,
     con un botón para abrir su ficha. Nunca se dice que son iguales.
   ========================================================= */

(() => {
  const $ = (id) => document.getElementById(id);
  const canvas = $("mesa-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");

  const ORDEN = ["Personas", "Tránsito", "Máquinas", "Naturaleza"];
  const RITMOS = [
    { patron: "P", texto: "puntual", eventos: "3 eventos" },
    { patron: "I", texto: "intermitente", eventos: "5 pasadas" },
    { patron: "C", texto: "continuo", eventos: "10 min" },
  ];
  const VALOR_RITMO = { P: 0, I: 0.5, C: 1 };
  const fmt = (n) => n.toLocaleString("es-CL", { maximumFractionDigits: 1 });
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const densidad = (db) => 0.35 + 0.65 * limitar((db - 50) / 30, 0, 1);

  // Estado de la mezcla (valor inicial: un momento "medio" del barrio)
  const mezcla = {
    db: 65,
    especies: {
      "Personas":   { n: 2, i: 3, r: 1 },
      "Tránsito":   { n: 2, i: 3.5, r: 1 },
      "Máquinas":   { n: 0, i: 3, r: 2 },
      "Naturaleza": { n: 1, i: 2, r: 2 },
    },
  };

  let familiasPorEspecie = {}; // familias más usadas de cada especie (desde los datos)
  let rasgos = [];             // rasgos de cada kami registrado, para comparar
  let kamiMesa = null;
  let t = 0, ultimo = null, pedido = null, visible = false;

  // ---------- Controles ----------
  function crearControles() {
    $("mesa-especies").innerHTML = ORDEN.map((e) => {
      const m = mezcla.especies[e];
      return `<fieldset class="mesa-especie" data-especie="${e}" style="--c:${ESPECIES[e].color}">
        <legend><i></i>${e}</legend>
        ${deslizador(e, "n", "Cantidad", 0, 5, 1, m.n)}
        ${deslizador(e, "i", "Intensidad", 1, 5, 0.5, m.i)}
        ${deslizador(e, "r", "Ritmo", 0, 2, 1, m.r)}
      </fieldset>`;
    }).join("");
    actualizarRotulos();
  }
  function deslizador(e, clave, nombre, min, max, paso, valor) {
    const id = `mesa-${clave}-${ORDEN.indexOf(e)}`;
    return `<div class="mesa-deslizador">
      <label for="${id}">${nombre}</label>
      <input type="range" id="${id}" data-especie="${e}" data-clave="${clave}" min="${min}" max="${max}" step="${paso}" value="${valor}">
      <output for="${id}"></output>
    </div>`;
  }
  function textoValor(clave, v, n) {
    if (clave === "n") return v === 0 ? "ninguno" : `${v} ${v === 1 ? "sonido" : "sonidos"}`;
    if (clave === "i") return n === 0 ? "—" : fmt(v);
    return n === 0 ? "—" : RITMOS[v].texto;
  }
  function actualizarRotulos() {
    document.querySelectorAll(".mesa-especie").forEach((fs) => {
      const m = mezcla.especies[fs.dataset.especie];
      fs.classList.toggle("mesa-especie--vacia", m.n === 0);
      fs.querySelectorAll("input").forEach((inp) => {
        inp.nextElementSibling.textContent = textoValor(inp.dataset.clave, m[inp.dataset.clave], m.n);
        inp.disabled = inp.dataset.clave !== "n" && m.n === 0;
      });
    });
    $("mesa-db").value = mezcla.db;
    $("mesa-db-valor").textContent = `${mezcla.db} dB`;
  }

  $("mesa-especies").addEventListener("input", (ev) => {
    const inp = ev.target.closest("input[type=range]");
    if (!inp) return;
    mezcla.especies[inp.dataset.especie][inp.dataset.clave] = parseFloat(inp.value);
    actualizarRotulos();
    cambio();
  });
  $("mesa-db").addEventListener("input", (ev) => {
    mezcla.db = parseFloat(ev.target.value);
    actualizarRotulos();
    cambio();
  });
  $("mesa-azar").addEventListener("click", () => {
    for (const e of ORDEN) {
      const m = mezcla.especies[e];
      m.n = Math.random() < 0.25 ? 0 : 1 + Math.floor(Math.random() * 4);
      m.i = 1 + Math.round(Math.random() * 8) / 2;
      m.r = Math.floor(Math.random() * 3);
    }
    mezcla.db = 55 + Math.round(Math.random() * 22);
    crearControles();
    cambio(true);
  });

  // Cargar un kami registrado en la mesa (desde el mezclador de la ficha)
  document.addEventListener("mesa-cargar", (ev) => {
    const k = CAMPO.obtener(ev.detail);
    if (!k) return;
    const r = rasgosDe(k.f);
    for (const e of ORDEN) {
      mezcla.especies[e] = {
        n: Math.min(5, r[e].n),
        i: r[e].n ? Math.round(r[e].i * 2) / 2 : 3,
        r: r[e].n ? Math.round(r[e].r * 2) : 1,
      };
    }
    mezcla.db = Math.round(limitar(k.f.db_prom, 50, 80));
    crearControles();
    cambio(true);
    $("mesa").scrollIntoView({ behavior: "smooth" });
  });

  // ---------- El kami de la mesa ----------
  function construirKami() {
    const sonidos = [];
    for (const e of ORDEN) {
      const m = mezcla.especies[e];
      const fams = familiasPorEspecie[e] || [];
      for (let k = 0; k < m.n; k++) {
        const fam = fams[k % Math.max(1, fams.length)];
        const ritmo = RITMOS[m.r];
        sonidos.push({
          fuente: fam ? fam.slice(2).replace(/-/g, " ") : e.toLowerCase(),
          categoria: e,
          tipo_ficha: "",
          intensidad: m.i,
          intensidad_texto: fmt(m.i),
          patron: ritmo.patron,
          patron_texto: ritmo.texto,
          eventos: ritmo.eventos,
          dura_todo_el_registro: ritmo.patron === "C",
          familia_sonido: fam,
        });
      }
    }
    const f = {
      id: "MESA", lugar: "Tu mezcla", hora_inicio: "12:00", duracion_min: 10, agrado: 3,
      db_prom: mezcla.db, db_min: mezcla.db - 9, db_max: mezcla.db + 12, sonidos,
    };
    kamiMesa = CAMPO.prepararKami(f);
  }

  // ---------- Comparación con los kamis registrados ----------
  function rasgosDe(f) {
    const r = {};
    for (const e of ORDEN) {
      const ss = f.sonidos.filter((s) => s.categoria === e);
      const n = ss.length;
      r[e] = {
        n,
        i: n ? ss.reduce((a, s) => a + (s.intensidad ?? 1), 0) / n : 0,
        r: n ? ss.reduce((a, s) => a + (VALOR_RITMO[s.patron] ?? 0.5), 0) / n : 0,
      };
    }
    r.db = f.db_prom;
    return r;
  }
  function rasgosMesa() {
    const r = {};
    for (const e of ORDEN) {
      const m = mezcla.especies[e];
      r[e] = { n: m.n, i: m.n ? m.i : 0, r: m.n ? m.r / 2 : 0 };
    }
    r.db = mezcla.db;
    return r;
  }
  // Distancia: cuántos sonidos de cada especie pesa más; luego intensidad, nivel y ritmo.
  function distancia(a, b) {
    let d = 0;
    for (const e of ORDEN) {
      d += 1.0 * ((a[e].n - b[e].n) / 5) ** 2;
      d += 0.6 * ((a[e].i - b[e].i) / 5) ** 2;
      d += 0.35 * (a[e].r - b[e].r) ** 2;
    }
    d += 1.0 * ((a.db - b.db) / 30) ** 2;
    return Math.sqrt(d);
  }
  const cercania = (d) =>
    d < 0.12 ? "Muy parecido a tu mezcla" : d < 0.3 ? "Se parece a tu mezcla" : "Es el más cercano, aunque suena distinto";

  function comparar() {
    const yo = rasgosMesa();
    const orden = rasgos.map((x) => ({ ...x, d: distancia(yo, x.r) })).sort((a, b) => a.d - b.d);
    mostrarResultado(orden[0], orden.slice(1, 3), yo);
  }

  function mostrarResultado(mejor, otros, yo) {
    if (!mejor) return;
    const f = mejor.k.f;
    const rango = f.db_min != null && f.db_max != null ? ` (${fmt(f.db_min)}–${fmt(f.db_max)})` : "";
    const filas = ORDEN.map((e) => {
      const t = yo[e], r = mejor.r[e];
      const txt = (x) => x.n ? `${x.n} · int. ${fmt(x.i)}` : "—";
      return `<tr><th><i style="background:${ESPECIES[e].color}"></i>${e}</th><td>${txt(t)}</td><td>${txt(r)}</td></tr>`;
    }).join("");
    $("mesa-resultado").innerHTML = `
      <div class="resultado">
        <div class="resultado__kami"><canvas id="mesa-parecido" aria-hidden="true"></canvas></div>
        <div class="resultado__texto">
          <p class="etiqueta">${cercania(mejor.d)} · así suena el kami de</p>
          <p class="resultado__lugar"><span class="display">${numeroLugar(f.lugar)}</span> <span class="display">${esc(f.lugar)}</span></p>
          <p class="mono resultado__meta">${f.id} · ${f.fecha?.split("-").reverse().join("-") ?? ""} · ${f.hora_inicio} · ${fmt(f.db_prom)} dB${rango} · ${esc(f.observador || "")}</p>
          ${f.situacion_destacada ? `<p class="resultado__voz">«${esc(f.situacion_destacada)}»</p>` : ""}
          <table class="resultado__tabla mono">
            <thead><tr><th></th><th>tu mezcla</th><th>${f.id}</th></tr></thead>
            <tbody>${filas}
              <tr><th>Nivel</th><td>${fmt(yo.db)} dB</td><td>${fmt(f.db_prom)} dB</td></tr>
            </tbody>
          </table>
          <div class="resultado__acciones">
            <button class="ficha__mezclar" type="button" data-abrir="${f.id}">Ver este kami →</button>
            ${otros.length ? `<span class="mono">También se parece a:</span>` : ""}
            ${otros.map((o) => `<button class="lugar-btn" type="button" data-abrir="${o.k.f.id}">${o.k.f.id} · ${esc(o.k.f.lugar)} ${o.k.f.hora_inicio}</button>`).join("")}
          </div>
        </div>
      </div>`;
    dibujarParecido(mejor.k);
  }

  $("mesa-resultado").addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-abrir]");
    if (!b) return;
    detenerAudio();
    document.dispatchEvent(new CustomEvent("abrir-ficha", { detail: b.dataset.abrir }));
  });

  // ---------- Dibujo ----------
  function angulosCuadrantes(k) {
    const por = {};
    k.brazos.forEach(({ s }, i) => (por[s.categoria] ||= []).push(i));
    const ang = [];
    ORDEN.forEach((e, q) => {
      const idx = por[e] || [];
      const paso = idx.length > 1 ? Math.min(0.34, 1.25 / (idx.length - 1)) : 0;
      idx.forEach((i, j) => (ang[i] = -Math.PI / 2 + q * (Math.PI / 2) + Math.PI / 4 + (j - (idx.length - 1) / 2) * paso));
    });
    return ang;
  }

  function dibujarEn(c, cv, k, tc, velo) {
    const dpr = window.devicePixelRatio || 1;
    const W = cv.clientWidth, H = cv.clientHeight;
    if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, W, H);
    const R = Math.min(W, H) / 2 - 8;
    const cx = W / 2, cy = H / 2;
    // velo: tamaño según dB máx., densidad según el nivel
    const rh = R * (0.55 + 0.45 * limitar(((k.f.db_max ?? k.f.db_prom) - 60) / 30, 0, 1));
    const fuera = 10000;
    c.save();
    c.shadowColor = `rgba(30, 28, 26, ${0.2 * velo})`;
    c.shadowBlur = R * 0.35 * dpr;
    c.shadowOffsetX = fuera * dpr;
    c.beginPath(); c.arc(cx - fuera, cy, rh, 0, Math.PI * 2); c.fill();
    c.restore();
    if (!k.brazos.length) {
      c.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--tinta-2");
      c.font = `12px "IBM Plex Mono", monospace`;
      c.textAlign = "center";
      c.fillText("silencio: sube la cantidad de alguna especie", cx, cy + R * 0.6);
    }
    CAMPO.dibujarKami(c, { ...k, x: cx, y: cy }, R / 58, 1, tc, { angulos: angulosCuadrantes(k) });
  }

  function dibujar() {
    if (!kamiMesa) return;
    const quieto = CAMPO.sinMovimiento();
    const sonando = MOTOR.kamiSonando() === kamiMesa;
    const tiempo = sonando ? CAMPO.tiempo() : t;
    const tc = quieto ? null : tiempo % CAMPO.CICLO;
    dibujarEn(ctx, canvas, kamiMesa, tc, densidad(mezcla.db));
    if (tc != null) {
      const seg = Math.floor((tc / CAMPO.CICLO) * 600);
      $("mesa-reloj").textContent = `minuto ${String(Math.floor(seg / 60)).padStart(2, "0")}:${String(seg % 60).padStart(2, "0")} de 10:00`;
    }
  }

  function dibujarParecido(k) {
    const cv = $("mesa-parecido");
    if (cv) dibujarEn(cv.getContext("2d"), cv, k, null, densidad(k.f.db_prom));
  }

  function cuadro(ahora) {
    pedido = null;
    if (ultimo != null) t += Math.min(0.1, (ahora - ultimo) / 1000);
    ultimo = ahora;
    dibujar();
    if (visible && !CAMPO.sinMovimiento() && !document.hidden) pedido = requestAnimationFrame(cuadro);
    else ultimo = null;
  }
  const arrancar = () => { if (pedido == null) pedido = requestAnimationFrame(cuadro); };

  // ---------- Cambios ----------
  let espera = null;
  function cambio(inmediato = false) {
    construirKami();
    dibujar();
    clearTimeout(espera);
    // la comparación y el audio se actualizan cuando el usuario suelta un poco el deslizador
    espera = setTimeout(() => {
      comparar();
      if (MOTOR.sonando() && sonandoMesa) sonarMesa();
      actualizarEstado();
    }, inmediato ? 0 : 250);
  }

  // ---------- Audio ----------
  let sonandoMesa = false;
  const boton = $("mesa-sonar");
  boton.addEventListener("click", () => (sonandoMesa ? detenerAudio() : sonarMesa()));

  async function sonarMesa() {
    if (!kamiMesa) return;
    const ok = await MOTOR.sonar(kamiMesa, { velo: () => densidad(mezcla.db) });
    if (!ok) { $("mesa-estado").textContent = "Este navegador no permite reproducir audio."; return; }
    sonandoMesa = true;
    boton.setAttribute("aria-pressed", "true");
    boton.textContent = "■ Detener";
  }
  function detenerAudio() {
    if (sonandoMesa) MOTOR.detener();
    sonandoMesa = false;
    boton.setAttribute("aria-pressed", "false");
    boton.textContent = "▶ Escuchar tu mezcla";
  }
  // si otro (la ficha) empieza a sonar, la mesa queda en silencio
  document.addEventListener("abrir-ficha", detenerAudio);

  async function actualizarEstado() {
    const fams = [...new Set(kamiMesa.brazos.map(({ s }) => s.familia_sonido).filter(Boolean))];
    if (!fams.length) { $("mesa-estado").textContent = ""; return; }
    const { faltan } = await MOTOR.resumenArchivos(fams);
    $("mesa-estado").textContent = faltan.length
      ? `Sin audio todavía para: ${faltan.join(", ")}.`
      : "";
  }

  // ---------- Arranque ----------
  function iniciar(fichas) {
    // familias de cada especie, de la más escuchada a la menos
    const cuenta = {};
    fichas.flatMap((f) => f.sonidos).forEach((s) => {
      if (!s.familia_sonido) return;
      (cuenta[s.categoria] ||= {})[s.familia_sonido] = (cuenta[s.categoria][s.familia_sonido] || 0) + 1;
    });
    for (const e of ORDEN)
      familiasPorEspecie[e] = Object.entries(cuenta[e] || {}).sort((a, b) => b[1] - a[1]).map(([fam]) => fam);

    rasgos = CAMPO.todos().map((k) => ({ k, r: rasgosDe(k.f) }));
    crearControles();
    cambio(true);
    new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) arrancar(); }).observe(canvas);
    new ResizeObserver(() => { dibujar(); }).observe(canvas);
  }

  // campo.js prepara los kamis al recibir los datos; la mesa espera a que estén listos
  const esperarCampo = () => (window.CAMPO?.todos().length ? iniciar(window.FICHAS) : setTimeout(esperarCampo, 50));
  if (window.FICHAS) esperarCampo();
  else document.addEventListener("datos-listos", esperarCampo, { once: true });
})();
