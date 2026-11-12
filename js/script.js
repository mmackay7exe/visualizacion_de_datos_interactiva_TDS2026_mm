/* =========================================================
   Halos Sonoros en la Ciudad Puerto — script compartido
   Carga la base de fichas y escribe los números en la página.
   Ningún número se escribe a mano: todo sale de los datos.
   ========================================================= */

const RUTA_DATOS = "assets/data/base_barrio_puerto.json";

// Lugares numerados del mar hacia el interior (orden fijo de la pieza).
const LUGARES = ["Muelle Prat", "Plaza Sotomayor", "Calle Serrano", "Plaza Echaurren"];

// Especies: el único color de la pieza (mismos valores que en style.css).
const ESPECIES = {
  "Personas":   { color: "#D6246E", clase: "c-personas" },
  "Tránsito":   { color: "#E4572E", clase: "c-transito" },
  "Máquinas":   { color: "#4B2E6B", clase: "c-maquinas" },
  "Naturaleza": { color: "#5E9FD6", clase: "c-naturaleza" },
};

const numeroLugar = (lugar) => String(LUGARES.indexOf(lugar) + 1).padStart(2, "0");

// Escalas del campo (reglas_especies.md §1). Se comparten con el anticipo de la portada.
const HORA_MIN = 9.5, HORA_MAX = 19.25;   // 09:30 – 19:15
const DB_MIN = 50, DB_MAX = 80;
const horaDecimal = (hhmm) => { const [h, m] = hhmm.split(":").map(Number); return h + m / 60; };
const limitar = (v, a, b) => Math.min(b, Math.max(a, v));

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio",
  "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

// La página ya tiene JS: activa los estilos que dependen de él (revelado).
document.documentElement.classList.add("js");

async function cargarDatos() {
  const resp = await fetch(RUTA_DATOS);
  if (!resp.ok) throw new Error(`No se encontró ${RUTA_DATOS} (${resp.status})`);
  return resp.json();
}

// Escribe en cada [data-dato="…"] el valor calculado.
function escribirConteos(fichas) {
  const conteos = {
    fichas: fichas.length,
    sonidos: fichas.reduce((suma, f) => suma + f.sonidos.length, 0),
    lugares: new Set(fichas.map((f) => f.lugar)).size,
  };
  document.querySelectorAll("[data-dato]").forEach((el) => {
    const valor = conteos[el.dataset.dato];
    if (valor !== undefined) el.textContent = valor;
  });
}

// Botones 01–04 del filtro por lugar (solo los lugares que existen en los datos).
function crearFiltroLugares(fichas) {
  const caja = document.getElementById("filtro-lugares");
  if (!caja) return;
  const presentes = LUGARES.filter((l) => fichas.some((f) => f.lugar === l));
  caja.innerHTML = presentes
    .map((l) => {
      const n = fichas.filter((f) => f.lugar === l).length;
      return `<button class="lugar-btn" type="button" aria-pressed="false" data-lugar="${l}"
                title="${n} registros"><b>${numeroLugar(l)}</b>${l}</button>`;
    })
    .join("");

  // De momento solo marca el botón; el campo (etapa 3) atenuará los demás kamis al 15 %.
  caja.addEventListener("click", (e) => {
    const btn = e.target.closest(".lugar-btn");
    if (!btn) return;
    const activo = btn.getAttribute("aria-pressed") === "true";
    caja.querySelectorAll(".lugar-btn").forEach((b) => b.setAttribute("aria-pressed", "false"));
    btn.setAttribute("aria-pressed", String(!activo));
    document.dispatchEvent(new CustomEvent("filtro-lugar", { detail: activo ? null : btn.dataset.lugar }));
  });
}

// "Entre el 13 y el 29 de octubre de 2026" (o con dos meses si cruza de mes).
function textoPeriodo(fichas) {
  const fechas = fichas.map((f) => f.fecha).filter(Boolean).sort();
  const [a1, m1, d1] = fechas[0].split("-").map(Number);
  const [a2, m2, d2] = fechas.at(-1).split("-").map(Number);
  if (fechas[0] === fechas.at(-1)) return `El ${d1} de ${MESES[m1 - 1]} de ${a1}`;
  if (a1 === a2 && m1 === m2) return `Entre el ${d1} y el ${d2} de ${MESES[m1 - 1]} de ${a1}`;
  if (a1 === a2) return `Entre el ${d1} de ${MESES[m1 - 1]} y el ${d2} de ${MESES[m2 - 1]} de ${a1}`;
  return `Entre el ${d1} de ${MESES[m1 - 1]} de ${a1} y el ${d2} de ${MESES[m2 - 1]} de ${a2}`;
}

// Anticipo de la portada: cada kami, tenue, en su lugar real del campo
// (X = hora, Y = dB promedio, velo vertical de dB mín a máx).
function dibujarAnticipo(fichas) {
  const svg = document.getElementById("anticipo-svg");
  if (!svg) return;
  const dibujar = () => {
    const w = svg.clientWidth, h = svg.clientHeight;
    if (!w || !h) return;
    const x = (f) => ((horaDecimal(f.hora_inicio) - HORA_MIN) / (HORA_MAX - HORA_MIN)) * w;
    const y = (db) => h - ((limitar(db, DB_MIN, DB_MAX) - DB_MIN) / (DB_MAX - DB_MIN)) * h;
    svg.setAttribute("viewBox", `0 0 ${w} ${h}`);

    const velos = fichas.map((f) => {
      const cx = x(f);
      if (f.db_min == null || f.db_max == null) // dato incompleto (BP-17): solo halo circular
        return `<circle cx="${cx}" cy="${y(f.db_prom)}" r="9"/>`;
      const ry = Math.max(6, (y(f.db_min) - y(f.db_max)) / 2);
      return `<ellipse cx="${cx}" cy="${(y(f.db_min) + y(f.db_max)) / 2}" rx="7" ry="${ry}"/>`;
    }).join("");
    const nucleos = fichas.map((f) => `<circle cx="${x(f)}" cy="${y(f.db_prom)}" r="2.2"/>`).join("");

    svg.innerHTML = `
      <defs><filter id="velo-anticipo" x="-100%" y="-100%" width="300%" height="300%">
        <feGaussianBlur stdDeviation="5"/></filter></defs>
      <g fill="var(--tinta)" filter="url(#velo-anticipo)" opacity=".16">${velos}</g>
      <g fill="var(--tinta)" opacity=".38">${nucleos}</g>`;
  };
  dibujar();
  new ResizeObserver(dibujar).observe(svg);
}

// Franja de lugares (01–04): número, nombre, cifras y un punto por sonido.
function crearFranjaLugares(fichas) {
  const lista = document.getElementById("lugares-franja");
  if (!lista) return;
  const orden = Object.keys(ESPECIES);
  lista.innerHTML = LUGARES.filter((l) => fichas.some((f) => f.lugar === l)).map((l) => {
    const delLugar = fichas.filter((f) => f.lugar === l);
    const sonidos = delLugar.flatMap((f) => f.sonidos)
      .sort((a, b) => orden.indexOf(a.categoria) - orden.indexOf(b.categoria));
    const resumen = orden
      .map((e) => [e, sonidos.filter((s) => s.categoria === e).length])
      .filter(([, n]) => n > 0)
      .map(([e, n]) => `${e} ${n}`).join(", ");
    const puntos = sonidos
      .map((s) => `<i style="background:${ESPECIES[s.categoria]?.color ?? "var(--linea)"}" title="${s.fuente} · ${s.categoria}"></i>`)
      .join("");
    return `<li class="lugar-ficha">
        <div class="lugar-ficha__n">${numeroLugar(l)}</div>
        <div class="lugar-ficha__nombre">${l}</div>
        <div class="lugar-ficha__cifras mono">${delLugar.length} ${delLugar.length === 1 ? "momento" : "momentos"} · ${sonidos.length} sonidos</div>
        <div class="puntos" role="img" aria-label="${resumen}">${puntos}</div>
      </li>`;
  }).join("");
}

// Revelado al bajar: los bloques salen del velo cuando entran en pantalla.
function activarRevelado() {
  const elementos = document.querySelectorAll(".revelar");
  if (!("IntersectionObserver" in window)) {
    elementos.forEach((el) => el.classList.add("visible"));
    return;
  }
  const obs = new IntersectionObserver((entradas) => {
    entradas.forEach((e) => {
      if (e.isIntersecting) { e.target.classList.add("visible"); obs.unobserve(e.target); }
    });
  }, { threshold: 0.15 });
  elementos.forEach((el) => obs.observe(el));
}
activarRevelado();

// Créditos de los audios (assets/audio/creditos.json, generado al descargarlos).
async function escribirCreditosAudio() {
  const lista = document.getElementById("creditos-audio");
  if (!lista) return;
  try {
    const creditos = await (await fetch("assets/audio/creditos.json")).json();
    const lic = (l) => (l === "Creative Commons 0" ? "CC0" : l === "Attribution" ? "CC BY" : l);
    const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    lista.innerHTML = creditos.map((c) =>
      `<li><span>${esc(c.familia)}</span> «${esc(c.titulo)}» — ${esc(c.autor)} · ${esc(lic(c.licencia))} · ` +
      `<a href="https://freesound.org/s/${encodeURIComponent(c.id)}/" target="_blank" rel="noopener">freesound #${esc(c.id)}</a></li>`
    ).join("");
  } catch {
    lista.innerHTML = "<li>Créditos de audio pendientes.</li>";
  }
}
escribirCreditosAudio();

// ---------- proyecto.html: cifras calculadas desde los datos ----------
function llenarProyecto(fichas) {
  const $ = (id) => document.getElementById(id);
  if (!$("tabla-lugares") && !$("tabla-especies")) return;
  const fmt = (n) => n.toLocaleString("es-CL", { maximumFractionDigits: 1 });
  const orden = Object.keys(ESPECIES);
  const sonidos = fichas.flatMap((f) => f.sonidos);
  const lista = (xs) => xs.length > 1 ? xs.slice(0, -1).join(", ") + " y " + xs.at(-1) : xs.join("");
  const contar = (xs) => xs.reduce((m, x) => (m.set(x, (m.get(x) || 0) + 1), m), new Map());

  // Observadores (con cuántos registros) y equipos de medición
  const obs = [...contar(fichas.map((f) => f.observador).filter(Boolean))].sort((a, b) => b[1] - a[1]);
  const textoObs = lista(obs.map(([n, c]) => `${n} (${c})`));
  if ($("lista-observadores")) $("lista-observadores").textContent = `${textoObs}. Entre paréntesis, cuántos registros hizo cada una y cada uno.`;
  if ($("creditos-observadores")) $("creditos-observadores").textContent = lista(obs.map(([n]) => n));
  const equipos = [...contar(fichas.map((f) => f.equipo).filter(Boolean))].map(([e]) => e);
  if ($("lista-equipos")) $("lista-equipos").textContent = lista(equipos);

  // Tabla de lugares: registros, horario, sonidos y un punto por sonido
  if ($("tabla-lugares")) {
    $("tabla-lugares").innerHTML = LUGARES.filter((l) => fichas.some((f) => f.lugar === l)).map((l) => {
      const fs = fichas.filter((f) => f.lugar === l);
      const horas = fs.map((f) => f.hora_inicio).sort();
      const ss = fs.flatMap((f) => f.sonidos).sort((a, b) => orden.indexOf(a.categoria) - orden.indexOf(b.categoria));
      const puntos = ss.map((s) => `<i style="background:${ESPECIES[s.categoria]?.color ?? "var(--linea)"}"></i>`).join("");
      return `<li>
          <span class="tabla-lugares__n display">${numeroLugar(l)}</span>
          <div>
            <b class="display">${l}</b>
            <span class="mono">${fs.length} registros · ${horas[0]}–${horas.at(-1)} · ${ss.length} sonidos</span>
            <span class="puntos">${puntos}</span>
          </div>
        </li>`;
    }).join("");
  }

  // Primera lectura por especie (sin porcentajes)
  if ($("tabla-especies")) {
    const filas = orden.map((e) => {
      const ss = sonidos.filter((s) => s.categoria === e);
      const conInt = ss.filter((s) => s.intensidad != null);
      const media = conInt.reduce((a, s) => a + s.intensidad, 0) / (conInt.length || 1);
      const continuos = ss.filter((s) => s.patron === "C").length;
      return `<tr><td><i class="${ESPECIES[e].clase}"></i>${e}</td><td>${ss.length}</td><td>${fmt(media)}</td><td>${continuos} de ${ss.length}</td></tr>`;
    }).join("");
    $("tabla-especies").innerHTML = `<thead><tr><th>Especie</th><th>Sonidos</th><th>Intensidad media</th><th>Continuos</th></tr></thead><tbody>${filas}</tbody>`;
  }
  if ($("dato-conviven")) {
    const todas = LUGARES.filter((l) => new Set(fichas.filter((f) => f.lugar === l).flatMap((f) => f.sonidos.map((s) => s.categoria))).size === orden.length);
    $("dato-conviven").textContent = todas.length
      ? `Las cuatro especies conviven en: ${lista(todas)}.`
      : "Ningún lugar reúne las cuatro especies.";
  }
  if ($("n-echaurren")) $("n-echaurren").textContent = fichas.filter((f) => f.lugar === "Plaza Echaurren").length;
  document.querySelectorAll('[data-dato="revision"]').forEach((el) => (el.textContent = fichas.filter((f) => f.notas_revision).length));
}

function avisarError(err) {
  console.error(err);
  document.querySelectorAll("[data-dato]").forEach((el) => (el.textContent = "?"));
  const aviso = document.createElement("p");
  aviso.className = "mono";
  aviso.style.cssText = "position:fixed;bottom:12px;left:12px;right:12px;padding:10px 14px;background:var(--tinta);color:var(--papel);z-index:60";
  aviso.textContent = "No se pudieron cargar los datos. Abre la página con Live Server (no con doble clic).";
  document.body.append(aviso);
}

cargarDatos()
  .then((fichas) => {
    window.FICHAS = fichas; // a mano para revisar en la consola
    escribirConteos(fichas);
    document.querySelectorAll('[data-dato="periodo"]').forEach((el) => (el.textContent = textoPeriodo(fichas)));
    crearFiltroLugares(fichas);
    dibujarAnticipo(fichas);
    crearFranjaLugares(fichas);
    llenarProyecto(fichas);
    document.dispatchEvent(new CustomEvent("datos-listos", { detail: fichas })); // lo escucha campo.js
  })
  .catch(avisarError);
