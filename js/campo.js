/* =========================================================
   Campo de kamis (nivel 1 · propuesta B)
   Especificación: 02_Concepto/reglas_especies.md §0–§3.
   - X = hora de inicio (09:30–19:15) · Y = dB promedio (50–80)
   - Velo: franja borrosa de dB mín a dB máx (recortada a 50–80)
   - Un brazo por sonido: largo = intensidad, trazo = patrón,
     cabeza y color = especie. Núcleo en tinta.
   - Textura según agrado: 1–2 áspero, 3 neutro, 4–5 fluido.
   - Tiempo: 1 ciclo de 20 s = el registro completo de 10 min.
     Cada sonido se enciende según su patrón y sus eventos.
   Usa constantes de script.js (LUGARES, ESPECIES, HORA_MIN…).
   ========================================================= */

(() => {
  const canvas = document.getElementById("campo-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const lienzo = document.getElementById("campo-lienzo");
  const etiqueta = document.getElementById("campo-etiqueta");
  const reloj = document.getElementById("campo-minuto");
  const botonPausa = document.getElementById("campo-pausa");

  // Capa fija (ejes + velos): se redibuja solo al cambiar tamaño o filtro.
  const capa = document.createElement("canvas");
  const cctx = capa.getContext("2d");
  let capaSucia = true;

  const ORDEN = ["Personas", "Tránsito", "Máquinas", "Naturaleza"];
  const OPACIDAD_PATRON = { C: 1, I: 0.75, P: 0.55 };
  const TRAZO_PATRON = { C: [], I: [5, 3], P: [2, 2] };

  const CICLO = 20;      // segundos en pantalla = un registro completo
  const REPOSO = 0.2;    // un sonido apagado deja una huella al 20 %
  const FUNDIDO = { aspero: 0.08, neutro: 0.2, fluido: 0.45 }; // textura según agrado

  const sinMovimiento = window.matchMedia("(prefers-reduced-motion: reduce)");

  let kamis = [];
  let dims = null;
  let lugarActivo = null;
  let enfocado = null;

  let t = 0;               // tiempo acumulado (s)
  let enPausa = false;
  let visible = false;
  let ultimoCuadro = null;
  let pedido = null;

  const fmt = (n) => n.toLocaleString("es-CL", { maximumFractionDigits: 1 });
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  let TINTA = "#1E1C1A";

  // Azar con semilla: cada kami se dibuja siempre igual.
  function azar(semilla) {
    let a = semilla >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let x = Math.imul(a ^ (a >>> 15), 1 | a);
      x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  }
  const hash = (s) => [...s].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261);

  // ---------- Del texto de "eventos" a números ----------
  // "4 pasadas" → n = 4 · "10 min" → frac = 1 · "3-4 min" → frac = 0,35
  // "CADA 2min" → n = 5 · "2 min- 2 veces" → n = 2, frac = 0,4
  function leerEventos(s, dur) {
    const txt = (s.eventos || "").toLowerCase();
    const nums = (txt.match(/\d+(?:[.,]\d+)?/g) || []).map((n) => parseFloat(n.replace(",", ".")));
    const valor = /\d\s*-\s*\d/.test(txt) ? (nums[0] + nums[1]) / 2 : nums[0];
    const r = { continuo: /continuo/.test(txt) || s.dura_todo_el_registro && !nums.length };
    if (/cada\s*\d+\s*min/.test(txt)) r.n = Math.round(dur / valor);
    else if (/min/.test(txt)) {
      const veces = txt.match(/(\d+)\s*veces/);
      if (veces) { r.n = +veces[1]; r.frac = Math.min(1, (nums[0] * r.n) / dur); }
      else r.frac = Math.min(1, valor / dur);
    } else if (/\d\s*s\b/.test(txt)) { /* segundos: no da número de eventos */ }
    else if (valor) r.n = valor;
    return r;
  }

  // Calendario de un sonido dentro del ciclo: tramos [inicio, fin] en que suena.
  function calendario(s, dur, rnd) {
    const patron = s.patron || "C"; // sin patrón anotado: no se inventa un ritmo
    const ev = leerEventos(s, dur);
    const N = ev.n ? Math.min(8, Math.max(1, Math.round(ev.n))) : null;

    const repartir = (k, largo) => {
      const hueco = CICLO / k, tramos = [];
      for (let i = 0; i < k; i++) {
        const a = i * hueco + rnd() * Math.max(0, hueco - largo);
        tramos.push([a, a + largo]);
      }
      return tramos;
    };

    // Continuo: activo todo el ciclo. También si estuvo presente casi todo el registro.
    if (patron === "C" || ev.continuo || (ev.frac != null && ev.frac >= 0.8)) {
      const k = N || 4; // pulsos (los usa el estallido del tránsito)
      const fase = rnd() * (CICLO / k);
      return { continuo: true, tramos: [[0, CICLO]], inicios: Array.from({ length: k }, (_, i) => fase + (i * CICLO) / k) };
    }

    let tramos;
    if (ev.frac != null) {
      // presente una fracción del registro (ej. "3 min" de 10)
      const total = ev.frac * CICLO;
      const k = N || (patron === "P" ? 1 : Math.max(1, Math.round(total / 2)));
      tramos = repartir(k, total / k);
    } else if (patron === "P") {
      tramos = repartir(N || 1, 1);                             // N destellos de ~1 s
    } else if (N) {
      tramos = repartir(N, Math.min(3, Math.max(0.8, 10 / N))); // N tramos, ~50 % del ciclo
    } else {
      // intermitente sin número: tramos al azar de 0,8–3 s, ~50 % del ciclo
      tramos = [];
      let x = rnd() * 2, encendido = rnd() < 0.5;
      while (x < CICLO) {
        const d = 0.8 + rnd() * 2.2;
        if (encendido) tramos.push([x, Math.min(CICLO, x + d)]);
        x += d; encendido = !encendido;
      }
    }
    return { continuo: false, tramos, inicios: tramos.map(([a]) => a) };
  }

  // Nivel de un sonido en el instante tc (0–20 s): 1 sonando, 0,2 en reposo.
  const suave = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
  function nivel(plan, tc, fundido) {
    if (plan.continuo) return 1;
    let e = 0;
    for (const [a, b] of plan.tramos) {
      for (const tt of [tc, tc + CICLO]) {
        const sube = suave((tt - a) / fundido + 1);
        const baja = 1 - suave((tt - b) / fundido);
        e = Math.max(e, Math.min(sube, baja));
      }
    }
    return REPOSO + (1 - REPOSO) * e;
  }

  // Estallido del tránsito: sube a 125 % en 0,15 s y vuelve en 0,9 s.
  function estallido(plan, tc) {
    let dt = Infinity;
    for (const a of plan.inicios) {
      const d = ((tc - a) % CICLO + CICLO) % CICLO;
      if (d < dt) dt = d;
    }
    if (dt < 0.15) return 1 + 0.25 * (dt / 0.15);
    if (dt < 1.05) return 1.25 - 0.25 * ((dt - 0.15) / 0.9);
    return 1;
  }

  // ---------- Preparar datos ----------
  function preparar(fichas) {
    kamis = fichas.map(prepararKami);
    crearLista(fichas);
  }

  // Una ficha → un kami listo para dibujar y sonar (también sirve para el kami de la mesa de mezcla).
  function prepararKami(f) {
    const semilla = hash(f.id);
    const rnd = azar(semilla ^ 0x9e3779b9);
    const dur = f.duracion_min || 10; // registros más largos se escalan al mismo ciclo
    const sonidos = [...f.sonidos].sort((a, b) => ORDEN.indexOf(a.categoria) - ORDEN.indexOf(b.categoria));
    return {
      f,
      semilla,
      hora: horaDecimal(f.hora_inicio),
      textura: f.agrado == null ? "neutro" : f.agrado <= 2 ? "aspero" : f.agrado >= 4 ? "fluido" : "neutro",
      brazos: sonidos.map((s, k) => ({
        s,
        angulo: -Math.PI / 2 + (2 * Math.PI * k) / sonidos.length, // desde arriba, sentido horario
        plan: calendario(s, dur, rnd),
        fase: rnd() * Math.PI * 2,
      })),
    };
  }

  // ---------- Medidas ----------
  function medir() {
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
    const ancho = lienzo.clientWidth;
    const alto = Math.round(Math.min(Math.max(ancho * 0.56, 26 * rem), window.innerHeight * 0.82));
    const dpr = window.devicePixelRatio || 1;
    for (const c of [canvas, capa]) {
      c.width = Math.round(ancho * dpr);
      c.height = Math.round(alto * dpr);
    }
    canvas.style.height = alto + "px";

    const m = { izq: 3.5 * rem, der: 1.5 * rem, arr: 2.5 * rem, aba: 2.75 * rem };
    const plotW = ancho - m.izq - m.der;
    const plotH = alto - m.arr - m.aba;
    dims = {
      ancho, alto, dpr, rem, m, plotW, plotH,
      sc: Math.min(1, Math.max(0.5, (0.62 * plotW) / 870)),   // escala de los kamis
      sv: Math.min(1.1, Math.max(0.6, plotW / 1100)),         // escala del velo
    };
    if (modo === "velos") {
      medirVelos();
      ubicarEnVelos(0);
    } else {
      kamis.forEach((k) => { k.x = X(k.hora); k.y = Y(k.f.db_prom); });
    }
    TINTA = css("--tinta");
    capaSucia = true;
  }

  // ---------- Escena de velos (propuesta A · reglas §6) ----------
  // Cada lugar es un campo de curvas de nivel:
  //   n.º de curvas = redondeo((dB prom. − 50) / 3)
  //   separación menor cuanto mayor es el rango dB máx. − dB mín. (lugar inestable → curvas apretadas)
  // Los kamis del lugar flotan dentro, sin ejes: alrededor del centro según su hora (como un reloj)
  // y más cerca del centro cuanto más fuerte sonaban.
  let modo = "campo";
  let lugaresVelo = [];

  function datosLugares() {
    return LUGARES.map((nombre, i) => {
      const fs = kamis.filter((k) => k.f.lugar === nombre).map((k) => k.f);
      if (!fs.length) return null;
      const prom = fs.reduce((a, f) => a + f.db_prom, 0) / fs.length;
      const conRango = fs.filter((f) => f.db_min != null && f.db_max != null);
      const rango = conRango.length ? conRango.reduce((a, f) => a + (f.db_max - f.db_min), 0) / conRango.length : null;
      return { nombre, i, n: fs.length, prom, rango, curvas: Math.max(1, Math.round((prom - 50) / 3)) };
    }).filter(Boolean);
  }

  function medirVelos() {
    const { ancho, alto, rem } = dims;
    const w = ancho / 2, h = alto / 2;
    lugaresVelo = datosLugares().map((L) => {
      const col = L.i % 2, fila = Math.floor(L.i / 2);
      const cx = w * col + w / 2, cy = h * fila + h / 2 + 0.75 * rem;
      const R = Math.min(w, h) / 2 - 1.25 * rem;
      // inestabilidad: rango medio de 15 dB (estable) a 35 dB (inestable)
      const inest = L.rango == null ? 0.5 : limitar((L.rango - 15) / 20, 0, 1);
      const sep = (R / L.curvas) * (1 - 0.45 * inest);
      return { ...L, cx, cy, R, sep, fase: L.i * 1.7 };
    });
  }

  function ubicarEnVelos(tiempo) {
    kamis.forEach((k) => {
      const L = lugaresVelo.find((l) => l.nombre === k.f.lugar);
      if (!L) return;
      const a = -Math.PI / 2 + ((k.hora - HORA_MIN) / (HORA_MAX - HORA_MIN)) * Math.PI * 2 * 0.92;
      const r = L.R * (0.18 + 0.72 * (1 - limitar((k.f.db_prom - DB_MIN) / (DB_MAX - DB_MIN), 0, 1)));
      const ox = Math.sin(tiempo * 0.21 + (k.semilla % 97)) * 4, oy = Math.cos(tiempo * 0.17 + (k.semilla % 89)) * 4;
      k.x = L.cx + Math.cos(a) * r + ox;
      k.y = L.cy + Math.sin(a) * r + oy;
    });
  }

  function dibujarFondoVelos(c) {
    const { rem } = dims;
    for (const L of lugaresVelo) {
      const a = lugarActivo && lugarActivo !== L.nombre ? 0.15 : 1;
      c.save();
      c.globalAlpha = a;
      // bruma del lugar: más densa cuanto más fuerte en promedio
      const dens = limitar((L.prom - 50) / 30, 0, 1);
      const g = c.createRadialGradient(L.cx, L.cy, 0, L.cx, L.cy, L.R * 1.05);
      g.addColorStop(0, `rgba(30, 28, 26, ${0.05 + 0.13 * dens})`);
      g.addColorStop(1, "rgba(30, 28, 26, 0)");
      c.fillStyle = g;
      c.beginPath(); c.arc(L.cx, L.cy, L.R * 1.05, 0, Math.PI * 2); c.fill();

      // curvas de nivel (de adentro hacia afuera)
      c.strokeStyle = TINTA;
      c.lineWidth = 0.8;
      for (let k = 1; k <= L.curvas; k++) {
        const r = L.sep * k;
        c.globalAlpha = a * (0.5 - 0.25 * (k / L.curvas));
        c.beginPath();
        for (let p = 0; p <= 96; p++) {
          const th = (p / 96) * Math.PI * 2;
          const rr = r * (1 + 0.07 * Math.sin(3 * th + L.fase + k * 0.45) + 0.04 * Math.sin(5 * th - L.fase * 0.7 + k * 0.3));
          const x = L.cx + Math.cos(th) * rr, y = L.cy + Math.sin(th) * rr;
          p ? c.lineTo(x, y) : c.moveTo(x, y);
        }
        c.stroke();
      }

      // rótulo del lugar
      c.globalAlpha = a;
      c.fillStyle = TINTA;
      c.textBaseline = "top";
      c.font = `${2.25 * rem}px Anton, sans-serif`;
      const x0 = L.cx - L.R - 0.25 * rem, y0 = L.cy - L.R - 1.5 * rem;
      c.fillText(String(L.i + 1).padStart(2, "0"), x0, y0);
      const ancho = c.measureText("00").width;
      c.font = `${1.0625 * rem}px Anton, sans-serif`;
      c.fillText(L.nombre.toUpperCase(), x0 + ancho + 0.5 * rem, y0 + 0.2 * rem);
      c.font = `${0.625 * rem}px "IBM Plex Mono", monospace`;
      c.fillStyle = css("--tinta-2");
      const rango = L.rango == null ? "s/d" : `${fmt(Math.round(L.rango))} dB`;
      c.fillText(`${L.n} momentos · prom. ${fmt(Math.round(L.prom))} dB · rango medio ${rango} · ${L.curvas} curvas`,
        x0 + ancho + 0.5 * rem, y0 + 1.45 * rem);
      c.restore();
    }
  }

  function cambiarModo(nuevo) {
    modo = nuevo;
    document.documentElement.dataset.campoModo = modo;
    const b = document.getElementById("campo-modo");
    if (b) {
      b.setAttribute("aria-pressed", String(modo === "velos"));
      b.textContent = modo === "velos" ? "Campo legible ⇄" : "Escena de velos ⇄";
    }
    canvas.setAttribute("aria-label", modo === "velos"
      ? "Escena de velos: cada lugar es un campo de curvas de nivel con sus kamis flotando dentro."
      : "Campo de kamis: cada momento registrado ubicado según su hora (eje horizontal) y su nivel promedio de decibeles (eje vertical).");
    enfocar(null);
    medir();
    refrescar();
  }
  document.getElementById("campo-modo")?.addEventListener("click", () => cambiarModo(modo === "velos" ? "campo" : "velos"));
  const X = (h) => dims.m.izq + ((h - HORA_MIN) / (HORA_MAX - HORA_MIN)) * dims.plotW;
  const Y = (db) => dims.m.arr + dims.plotH - ((limitar(db, DB_MIN, DB_MAX) - DB_MIN) / (DB_MAX - DB_MIN)) * dims.plotH;
  const alfa = (k) => (lugarActivo && k.f.lugar !== lugarActivo ? 0.15 : 1);

  // ---------- Dibujo ----------
  function dibujar() {
    if (!dims) return;
    const { dpr } = dims;
    if (capaSucia) {
      cctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cctx.clearRect(0, 0, dims.ancho, dims.alto);
      if (modo === "velos") dibujarFondoVelos(cctx);
      else {
        dibujarEjes(cctx);
        [...kamis].sort((a, b) => alfa(a) - alfa(b)).forEach((k) => dibujarVelo(cctx, k, alfa(k)));
      }
      capaSucia = false;
    }
    if (modo === "velos" && !sinMovimiento.matches) ubicarEnVelos(t); // los kamis flotan
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(capa, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const animar = !sinMovimiento.matches;
    const tc = animar ? t % CICLO : null;
    // primero los atenuados, al final el que está bajo el cursor
    [...kamis]
      .sort((a, b) => alfa(a) - alfa(b) || (a === enfocado) - (b === enfocado))
      .forEach((k) => dibujarKami(ctx, k, dims.sc, alfa(k), tc));
  }

  function dibujarEjes(c) {
    const { m, plotW, plotH, rem } = dims;
    const tinta2 = css("--tinta-2"), linea = css("--linea");
    c.save();
    c.font = `${0.6875 * rem}px "IBM Plex Mono", monospace`;
    c.fillStyle = tinta2;
    c.lineWidth = 1;

    c.textAlign = "right";
    c.textBaseline = "middle";
    for (let db = DB_MIN; db <= DB_MAX; db += 5) {
      const y = Math.round(Y(db)) + 0.5;
      c.strokeStyle = linea;
      c.globalAlpha = db === DB_MIN ? 1 : 0.45;
      c.beginPath(); c.moveTo(m.izq, y); c.lineTo(m.izq + plotW, y); c.stroke();
      c.globalAlpha = 1;
      c.fillText(`${db} dB`, m.izq - 0.5 * rem, y);
    }

    c.textAlign = "center";
    c.textBaseline = "top";
    c.setLineDash([1, 5]);
    for (let h = Math.ceil(HORA_MIN); h <= Math.floor(HORA_MAX); h++) {
      const x = Math.round(X(h)) + 0.5;
      c.strokeStyle = linea;
      c.beginPath(); c.moveTo(x, m.arr); c.lineTo(x, m.arr + plotH); c.stroke();
      c.fillText(`${String(h).padStart(2, "0")}:00`, x, m.arr + plotH + 0.75 * rem);
    }
    c.setLineDash([]);

    c.textAlign = "left";
    c.textBaseline = "alphabetic";
    c.fillText("↑ MÁS FUERTE · dB PROMEDIO", m.izq, m.arr - 1 * rem);
    c.textAlign = "right";
    c.fillText("HORA DEL REGISTRO →", m.izq + plotW, m.arr - 1 * rem);
    c.restore();
  }

  // Velo: franja borrosa de dB mín a dB máx (desenfoque con sombra: funciona también en Safari).
  function dibujarVelo(c, k, a) {
    const { sv, dpr } = dims;
    const f = k.f;
    const ancho = 28 * sv, blur = 14 * sv;
    const fuera = 10000;
    c.save();
    c.shadowColor = `rgba(30, 28, 26, ${0.16 * a})`;
    c.shadowBlur = blur * dpr;
    c.shadowOffsetX = fuera * dpr;
    c.fillStyle = "#000";
    c.beginPath();
    if (f.db_min == null || f.db_max == null) {
      c.arc(k.x - fuera, k.y, ancho * 0.6, 0, Math.PI * 2); // dato incompleto (BP-17)
    } else {
      const y1 = Y(f.db_max), y2 = Y(f.db_min);
      const alto = Math.max(ancho, y2 - y1);
      c.roundRect(k.x - ancho / 2 - fuera, (y1 + y2) / 2 - alto / 2, ancho, alto, ancho / 2);
    }
    c.fill();
    c.restore();
  }

  // Un kami: brazos (uno por sonido) y núcleo. tc = instante del ciclo (null = estático).
  // opts.angulos: ángulos propios por brazo (la ficha los separa en cuadrantes).
  function dibujarKami(c, k, sc, a, tc, opts = {}) {
    const rnd = azar(k.semilla);
    const tiembla = k.textura === "aspero" ? 1.5 * sc : 0;
    // borde áspero: tiembla un poco en el tiempo
    const j = () => {
      const r1 = rnd(), r2 = rnd();
      return tiembla ? (r1 - 0.5) * 2 * tiembla * (tc == null ? 1 : Math.cos(tc * 18 + r2 * 6.28)) : 0;
    };
    c.save();
    c.lineCap = k.textura === "fluido" ? "round" : "butt";

    k.brazos.forEach(({ s, angulo: anguloCampo, plan, fase }, idx) => {
      const angulo = opts.angulos?.[idx] ?? anguloCampo;
      const i = s.intensidad ?? 1;
      const sinDato = s.intensidad == null;
      const L = (8 + (sinDato ? 1 : i) * 7) * sc; // 15–43 px a escala 1
      const x0 = k.x, y0 = k.y;
      const x1 = x0 + Math.cos(angulo) * L + j(), y1 = y0 + Math.sin(angulo) * L + j();
      // Mezclador: una especie silenciada deja solo un tallo punteado y tenue
      if (opts.apagadas?.has(s.categoria)) {
        c.strokeStyle = TINTA;
        c.lineWidth = 0.7;
        c.globalAlpha = a * 0.18;
        c.setLineDash([2, 3]);
        c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke();
        c.setLineDash([]);
        cabeza(c, s.categoria, x0, y0, x1, y1, i, Math.max(0.6, sc), s.patron, rnd, j, {}, true);
        return;
      }
      const lv = tc == null ? 1 : nivel(plan, tc, FUNDIDO[k.textura]);

      // tallo en tinta: el trazo dice el patrón; se aclara cuando el sonido calla
      c.strokeStyle = TINTA;
      c.lineWidth = 0.7 * Math.max(1, sc * 0.6);
      c.globalAlpha = a * 0.55 * (0.45 + 0.55 * lv);
      c.setLineDash(sinDato ? [2, 2] : (TRAZO_PATRON[s.patron] || []));
      c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke();
      c.setLineDash([]);

      c.globalAlpha = a * lv;
      const anim = tc == null ? {} : {
        respira: 1 + 0.08 * Math.sin((2 * Math.PI * tc) / 4 + fase),       // personas: ±8 % cada 4 s
        estalla: estallido(plan, tc),                                       // tránsito
        vibra: 1.5 * sc * Math.sin(2 * Math.PI * 12 * tc + fase) * lv,       // máquinas: ±1,5 px a 12 Hz
        deriva: { tc, amp: 2.5 * sc },                                      // naturaleza
      };
      cabeza(c, s.categoria, x0, y0, x1, y1, i, Math.max(0.6, sc), s.patron, rnd, j, anim);
    });

    c.globalAlpha = a;
    c.fillStyle = TINTA;
    c.beginPath(); c.arc(k.x, k.y, 3.2 * sc, 0, Math.PI * 2); c.fill();

    if (k === enfocado) {
      c.strokeStyle = TINTA;
      c.lineWidth = 1;
      c.beginPath(); c.arc(k.x, k.y, 3.2 * sc + 4, 0, Math.PI * 2); c.stroke();
    }
    c.restore();
  }

  // Cabeza de cada brazo según la especie (formas del wireframe v2 + movimiento de §2).
  // Importante: siempre consume la misma cantidad de rnd(), así la forma no salta entre cuadros.
  // invisible = true: recorre igual el azar (para que los otros brazos no salten) pero no se ve.
  function cabeza(c, especie, x0, y0, x1, y1, i, sc, patron, rnd, j = () => 0, anim = {}, invisible = false) {
    const color = ESPECIES[especie]?.color ?? "#999";
    const L = Math.hypot(x1 - x0, y1 - y0) || 1;
    const ux = (x1 - x0) / L, uy = (y1 - y0) / L, px = -uy, py = ux;
    const op = OPACIDAD_PATRON[patron] ?? 0.75;
    const base = invisible ? 0 : c.globalAlpha;
    c.fillStyle = color;
    c.strokeStyle = color;
    c.globalAlpha = base * op;

    if (especie === "Personas") {
      // racimo que respira
      const b = anim.respira ?? 1;
      for (let n = 0; n < 3; n++) {
        const cx = x0 + ux * L * (0.45 + 0.27 * n) * b, cy = y0 + uy * L * (0.45 + 0.27 * n) * b;
        for (let p = 0; p < Math.floor(2 + i * 1.6); p++) {
          const r = rnd() * 4.5 * sc * b, a = rnd() * Math.PI * 2, rr = (0.9 + rnd() * 0.9) * sc;
          c.beginPath();
          c.arc(cx + Math.cos(a) * r + j(), cy + Math.sin(a) * r + j(), rr, 0, Math.PI * 2);
          c.fill();
        }
      }
    } else if (especie === "Tránsito") {
      // masa que estalla y se repliega
      c.lineWidth = 1.6 * sc;
      c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke();
      const R = (2.2 + i * 1.1) * sc * (anim.estalla ?? 1);
      c.globalAlpha = base * (0.85 * op + 0.15);
      c.beginPath();
      for (let n = 0; n < 14; n++) {
        const a = (n / 14) * Math.PI * 2;
        const rr = R * (1 + 0.28 * Math.sin(3 * a + x1) + 0.15 * rnd());
        const x = x1 + Math.cos(a) * rr + j(), y = y1 + Math.sin(a) * rr + j();
        n ? c.lineTo(x, y) : c.moveTo(x, y);
      }
      c.closePath(); c.fill();
    } else if (especie === "Máquinas") {
      // trazos rígidos que vibran
      const v = anim.vibra ?? 0;
      c.lineWidth = Math.max(1, 1.1 * sc); // más fino se ve gris en vez de violeta
      const n = Math.floor(1 + i * 1.2);
      for (let k = 0; k < n; k++) {
        const off = (k - (n - 1) / 2) * 2.4 * sc + v;
        c.beginPath();
        c.moveTo(x0 + px * off + ux * L * 0.25, y0 + py * off + uy * L * 0.25);
        c.lineTo(x1 + px * off, y1 + py * off);
        c.stroke();
      }
    } else {
      // naturaleza: partículas finas que derivan
      const d = anim.deriva;
      for (let p = 0; p < Math.floor(6 + i * 5); p++) {
        const tt = rnd(), abre = (3 + tt * 9) * sc, ra = rnd(), rb = rnd(), f1 = rnd() * 6.28, f2 = rnd() * 6.28;
        let cx = x0 + ux * L * (0.3 + tt * 0.9) + px * (ra - 0.5) * abre * 2;
        let cy = y0 + uy * L * (0.3 + tt * 0.9) + py * (rb - 0.5) * abre * 2;
        if (d) {
          cx += Math.sin(d.tc * 0.55 + f1) * d.amp + Math.sin(d.tc * 0.23 + f2) * d.amp * 0.6;
          cy += Math.cos(d.tc * 0.41 + f2) * d.amp * 0.7;
        }
        c.beginPath(); c.arc(cx, cy, 0.65 * sc, 0, Math.PI * 2); c.fill();
      }
    }
    c.globalAlpha = base;
  }

  // ---------- Leyenda: una muestra de cada especie ----------
  function dibujarMuestras() {
    document.querySelectorAll("canvas[data-muestra]").forEach((m) => {
      const dpr = window.devicePixelRatio || 1;
      const w = m.clientWidth || 40, h = m.clientHeight || 16;
      m.width = w * dpr; m.height = h * dpr;
      const c = m.getContext("2d");
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.clearRect(0, 0, w, h);
      c.globalAlpha = 1;
      cabeza(c, m.dataset.muestra, 2, h / 2, w - 6, h / 2, 3, 0.85, "C", azar(hash(m.dataset.muestra)));
    });
  }

  // ---------- Bucle de animación ----------
  function cuadro(ahora) {
    pedido = null;
    if (ultimoCuadro != null) t += Math.min(0.1, (ahora - ultimoCuadro) / 1000);
    ultimoCuadro = ahora;
    dibujar();
    actualizarReloj();
    if (debeAnimar()) pedido = requestAnimationFrame(cuadro);
    else ultimoCuadro = null;
  }
  let tapado = false; // la ficha abierta cubre el campo: no se anima por debajo
  let relojExterno = null;
  const debeAnimar = () => visible && !enPausa && !tapado && !sinMovimiento.matches && !document.hidden;
  function arrancar() {
    if (pedido == null && debeAnimar()) pedido = requestAnimationFrame(cuadro);
  }
  // Redibuja una vez (cuando está en pausa o sin movimiento) o deja que el bucle lo haga.
  function refrescar() {
    if (pedido == null) dibujar();
  }

  // Minuto del registro: 20 s en pantalla = 10 min en terreno.
  let ultimoSeg = -1;
  function actualizarReloj() {
    if (!reloj) return;
    const seg = Math.floor(((t % CICLO) / CICLO) * 600);
    if (seg === ultimoSeg) return;
    ultimoSeg = seg;
    const mm = String(Math.floor(seg / 60)).padStart(2, "0"), ss = String(seg % 60).padStart(2, "0");
    reloj.textContent = `${mm}:${ss} / 10:00`;
  }

  botonPausa?.addEventListener("click", () => {
    enPausa = !enPausa;
    botonPausa.setAttribute("aria-pressed", String(enPausa));
    botonPausa.textContent = enPausa ? "Seguir" : "Pausa";
    arrancar();
  });
  document.addEventListener("visibilitychange", arrancar);
  sinMovimiento.addEventListener?.("change", () => { actualizarControles(); arrancar(); refrescar(); });
  function actualizarControles() {
    const quieto = sinMovimiento.matches;
    if (botonPausa) botonPausa.hidden = quieto;
    if (reloj) reloj.hidden = quieto;
  }

  // ---------- Etiqueta al pasar el cursor ----------
  function textoKami(f) {
    const rango = f.db_min != null && f.db_max != null ? `(${fmt(f.db_min)}–${fmt(f.db_max)})` : "(mín. y máx.: dato incompleto)";
    return {
      linea1: `${f.id} · ${f.lugar.toUpperCase()} · ${f.hora_inicio}`,
      linea2: `${fmt(f.db_prom)} dB ${rango} · ${f.sonidos.length} sonidos`,
    };
  }

  function buscar(ev) {
    const r = canvas.getBoundingClientRect();
    const x = ev.clientX - r.left, y = ev.clientY - r.top;
    const radio = 22 * dims.sc + 6;
    let mejor = null, dmin = Infinity;
    kamis.forEach((k) => {
      if (lugarActivo && k.f.lugar !== lugarActivo) return;
      const d = Math.hypot(k.x - x, k.y - y);
      if (d < radio && d < dmin) { mejor = k; dmin = d; }
    });
    return mejor;
  }

  function enfocar(k) {
    if (k === enfocado) return;
    enfocado = k;
    canvas.style.cursor = k ? "pointer" : "default";
    if (!k) {
      etiqueta.hidden = true;
    } else {
      const { linea1, linea2 } = textoKami(k.f);
      etiqueta.innerHTML = `<b>${linea1}</b><br><span>${linea2}</span>`;
      etiqueta.hidden = false;
      const desp = 0.9 * dims.rem;
      const derecha = k.x + desp + etiqueta.offsetWidth < dims.ancho;
      etiqueta.style.left = (derecha ? k.x + desp : k.x - desp - etiqueta.offsetWidth) + "px";
      etiqueta.style.top = Math.max(0, k.y - etiqueta.offsetHeight - desp) + "px";
    }
    refrescar();
  }

  canvas.addEventListener("pointermove", (ev) => enfocar(buscar(ev)));
  canvas.addEventListener("pointerleave", () => enfocar(null));
  canvas.addEventListener("click", (ev) => {
    const k = buscar(ev);
    enfocar(k);
    // Etapa 5: la ficha escuchará este evento.
    if (k) document.dispatchEvent(new CustomEvent("abrir-ficha", { detail: k.f.id }));
  });

  // ---------- Filtro por lugar (botones 01–04 de script.js) ----------
  document.addEventListener("filtro-lugar", (ev) => {
    lugarActivo = ev.detail;
    capaSucia = true;
    if (enfocado && lugarActivo && enfocado.f.lugar !== lugarActivo) enfocar(null);
    refrescar();
  });

  // ---------- Lista para lectores de pantalla ----------
  function crearLista(fichas) {
    const lista = document.getElementById("campo-lista");
    if (!lista) return;
    lista.innerHTML = fichas.map((f) => {
      const { linea1, linea2 } = textoKami(f);
      const porEspecie = ORDEN.map((e) => [e, f.sonidos.filter((s) => s.categoria === e).length])
        .filter(([, n]) => n).map(([e, n]) => `${e} ${n}`).join(", ");
      return `<li>${linea1} · ${linea2}: ${porEspecie}</li>`;
    }).join("");
  }

  // ---------- Arranque ----------
  async function iniciar(fichas) {
    preparar(fichas);
    await document.fonts.ready;
    medir();
    actualizarControles();
    dibujar();
    dibujarMuestras();
    new ResizeObserver(() => { medir(); enfocar(null); refrescar(); }).observe(lienzo);
    // Solo se anima mientras el campo está en pantalla.
    new IntersectionObserver(([e]) => { visible = e.isIntersecting; arrancar(); }).observe(lienzo);
  }

  if (window.FICHAS) iniciar(window.FICHAS);
  else document.addEventListener("datos-listos", (ev) => iniciar(ev.detail), { once: true });

  // API para la ficha (ficha.js) y para revisar en la consola: CAMPO.calendario("BP-21")
  window.CAMPO = {
    obtener: (id) => kamis.find((k) => k.f.id === id),
    todos: () => kamis,
    prepararKami,
    // ids en orden de hora; si hay un lugar filtrado, solo los de ese lugar
    recorrido: () => kamis
      .filter((k) => !lugarActivo || k.f.lugar === lugarActivo)
      .sort((a, b) => a.hora - b.hora || a.f.id.localeCompare(b.f.id))
      .map((k) => k.f.id),
    dibujarKami,
    textoKami,
    nivel: (plan, tc, textura) => nivel(plan, tc, FUNDIDO[textura]),
    // Mientras suena el mezclador, el reloj lo marca el audio (así imagen y sonido coinciden).
    tiempo: () => (relojExterno ? relojExterno() : t),
    avanzar: (dt) => { if (!relojExterno) t += dt; },
    fijarReloj: (fn) => { if (!fn && relojExterno) t = relojExterno(); relojExterno = fn; },
    calendarioDe: (brazo) => brazo.plan,
    texturaFundido: (textura) => FUNDIDO[textura],
    enPausa: () => enPausa,
    sinMovimiento: () => sinMovimiento.matches,
    tapar: (si) => { tapado = si; if (!si) { ultimoCuadro = null; arrancar(); } },
    CICLO,
    calendario: (id) => kamis.find((k) => k.f.id === id)?.brazos.map(({ s, plan }) => ({
      fuente: s.fuente, patron: s.patron, eventos: s.eventos,
      continuo: plan.continuo, tramos: plan.tramos.map(([a, b]) => `${a.toFixed(1)}–${b.toFixed(1)} s`).join(", "),
    })),
  };
})();
