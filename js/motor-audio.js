/* =========================================================
   Motor de audio (lo usan el mezclador de la ficha y la mesa de mezcla)
   reglas_especies.md §5:
     ganancia del sonido = (intensidad / 5)^1,5
     ganancia general: 54 dB → −18 dB · 78 dB → 0 dB (lineal)
     C en loop · I con compuerta según su calendario · P disparos sueltos
   Velo sonoro (abstracción): todo pasa por un filtro y una reverberación.
   Cuanto más denso el velo, más apagado y lejano suena; al descorrerlo,
   el sonido se aclara. Así el audio no es literal: es el lugar "detrás del velo".
   Sin archivos, todo funciona igual, en silencio.
   ========================================================= */

(() => {
  const RUTA_AUDIO = "assets/audio/";

  const gananciaSonido = (s) => Math.pow((s.intensidad ?? 1) / 5, 1.5);
  const dbGeneral = (dbProm) => -18 + limitar((dbProm - 54) / (78 - 54), 0, 1) * 18;
  const deDb = (db) => Math.pow(10, db / 20);

  // ---------- Archivos ----------
  const estadoArchivo = new Map(); // familia → "ok" | "falta" | "sintetizado"
  const buffers = new Map();

  const SINTESIS = {
    // alarma de retroceso: pitido de 1 kHz, 0,5 s encendido / 0,5 s apagado
    "M-retroceso": (ctx) => {
      const b = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = b.getChannelData(0);
      for (let i = 0; i < d.length / 2; i++) {
        const env = Math.min(1, i / 200, (d.length / 2 - i) / 200);
        d[i] = Math.sin((2 * Math.PI * 1000 * i) / ctx.sampleRate) * 0.5 * env;
      }
      return b;
    },
  };

  async function comprobar(familia) {
    if (estadoArchivo.has(familia)) return estadoArchivo.get(familia);
    let estado = "falta";
    try {
      const r = await fetch(RUTA_AUDIO + encodeURIComponent(familia) + ".mp3", { method: "HEAD" });
      if (r.ok) estado = "ok";
    } catch { /* sin servidor o sin archivo */ }
    if (estado === "falta" && SINTESIS[familia]) estado = "sintetizado";
    estadoArchivo.set(familia, estado);
    return estado;
  }

  function cargar(ctx, familia) {
    if (!buffers.has(familia)) {
      buffers.set(familia, (async () => {
        const estado = await comprobar(familia);
        if (estado === "sintetizado") return SINTESIS[familia](ctx);
        if (estado !== "ok") return null;
        try {
          const datos = await (await fetch(RUTA_AUDIO + encodeURIComponent(familia) + ".mp3")).arrayBuffer();
          return await ctx.decodeAudioData(datos);
        } catch (e) {
          console.warn("No se pudo leer el audio", familia, e);
          estadoArchivo.set(familia, "falta");
          return null;
        }
      })());
    }
    return buffers.get(familia);
  }

  // Resumen de qué familias tienen audio (para mostrarlo en pantalla).
  async function resumenArchivos(familias) {
    const estados = await Promise.all(familias.map(comprobar));
    return {
      con: familias.filter((_, i) => estados[i] !== "falta"),
      faltan: familias.filter((_, i) => estados[i] === "falta"),
    };
  }

  // ---------- Contexto y velo sonoro ----------
  let ctx = null, entrada = null, filtro = null, seco = null, mojado = null;

  // Respuesta de una sala grande y difusa (ruido que se apaga en ~4 s)
  function reverberacion(ctx, seg = 4.2) {
    const n = Math.round(ctx.sampleRate * seg);
    const b = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2.6);
    }
    return b;
  }

  async function contexto() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!ctx) {
      ctx = new AC();
      entrada = ctx.createGain();
      filtro = ctx.createBiquadFilter();
      filtro.type = "lowpass";
      filtro.Q.value = 0.4;
      seco = ctx.createGain();
      mojado = ctx.createGain();
      const sala = ctx.createConvolver();
      sala.buffer = reverberacion(ctx);
      // compresor final: con muchos sonidos fuertes a la vez, la suma no satura
      const compresor = ctx.createDynamicsCompressor();
      compresor.threshold.value = -14;
      compresor.ratio.value = 4;
      compresor.connect(ctx.destination);
      entrada.connect(filtro);
      filtro.connect(seco).connect(compresor);
      filtro.connect(sala).connect(mojado).connect(compresor);
      fijarVelo(1);
    }
    await ctx.resume();
    return ctx;
  }

  // v = 0 (sin velo: claro, cercano) … 1 (velo denso: apagado, lejano)
  function fijarVelo(v) {
    if (!ctx) return;
    const t = ctx.currentTime;
    v = limitar(v, 0, 1);
    filtro.frequency.setTargetAtTime(9000 * Math.pow(900 / 9000, v), t, 0.25); // 9 kHz → 900 Hz
    seco.gain.setTargetAtTime(1 - 0.55 * v, t, 0.25);
    mojado.gain.setTargetAtTime(0.25 + 0.75 * v, t, 0.25);
  }

  // ---------- Sesión: los sonidos de un kami ----------
  // opciones: apagadas() → Set de especies silenciadas · factor(s) → multiplicador extra
  //           velo() → 0–1 · alCambiar() → aviso de estado
  let sesion = null, pedido = null;

  async function sonar(kami, opciones = {}) {
    const c = await contexto();
    if (!c) return false;
    const anterior = sesion;
    const nueva = { kami, opciones, voces: [], prevTc: null, master: c.createGain() };
    nueva.master.gain.value = 0;
    nueva.master.connect(entrada);
    sesion = nueva;

    // el reloj del dibujo sigue al audio (si es la primera sesión)
    if (!anterior) {
      const base = CAMPO.tiempo(), inicio = c.currentTime;
      CAMPO.fijarReloj(() => base + (c.currentTime - inicio));
    }

    nueva.voces = await Promise.all(kami.brazos.map(async (b) => {
      const s = b.s;
      const buffer = s.familia_sonido ? await cargar(c, s.familia_sonido) : null;
      const plan = b.plan;
      const g = c.createGain();
      g.gain.value = 0;
      g.connect(nueva.master);
      const v = { s, plan, g, buffer, loop: null, disparos: !plan.continuo && s.patron === "P",
                  velocidad: 0.84 + Math.random() * 0.12 }; // un poco más grave: menos literal
      if (buffer && !v.disparos) {
        v.loop = c.createBufferSource();
        v.loop.buffer = buffer;
        v.loop.loop = true;
        v.loop.playbackRate.value = v.velocidad;
        v.loop.connect(g);
        v.loop.start(0, Math.random() * buffer.duration);
      }
      return v;
    }));
    if (sesion !== nueva) { cerrar(nueva, 0); return false; }

    nueva.master.gain.setTargetAtTime(deDb(dbGeneral(kami.f.db_prom)), c.currentTime, 0.3);
    if (anterior) cerrar(anterior, 0.35); // fundido entre la mezcla anterior y la nueva
    if (pedido == null) pedido = requestAnimationFrame(actualizar);
    return true;
  }

  function actualizar() {
    pedido = null;
    if (!sesion) return;
    const { kami, opciones, voces } = sesion;
    const tc = CAMPO.tiempo() % CAMPO.CICLO;
    const ahora = ctx.currentTime;
    const apagadas = opciones.apagadas?.() ?? new Set();
    fijarVelo(opciones.velo?.() ?? 1);
    for (const v of voces) {
      const on = !apagadas.has(v.s.categoria);
      const base = gananciaSonido(v.s) * (opciones.factor?.(v.s) ?? 1);
      if (v.disparos) {
        if (v.buffer && on && sesion.prevTc != null) {
          for (const a of v.plan.inicios) {
            const p = sesion.prevTc;
            if (p <= tc ? p < a && a <= tc : a > p || a <= tc) disparar(v, base);
          }
        }
        v.g.gain.setTargetAtTime(on ? 1 : 0, ahora, 0.05);
      } else {
        const nivel = CAMPO.nivel(v.plan, tc, kami.textura);
        const env = v.plan.continuo ? 1 : Math.max(0, (nivel - 0.2) / 0.8);
        v.g.gain.setTargetAtTime(on ? base * env : 0, ahora, 0.06);
      }
    }
    sesion.prevTc = tc;
    pedido = requestAnimationFrame(actualizar);
  }

  function disparar(v, ganancia) {
    const src = ctx.createBufferSource();
    const g = ctx.createGain();
    const dur = Math.min(v.buffer.duration, 3);
    const desde = Math.random() * Math.max(0, v.buffer.duration - dur);
    src.buffer = v.buffer;
    src.playbackRate.value = v.velocidad;
    g.gain.setValueAtTime(0, ctx.currentTime);
    g.gain.linearRampToValueAtTime(ganancia, ctx.currentTime + 0.08);
    g.gain.setTargetAtTime(0, ctx.currentTime + dur - 0.4, 0.15);
    src.connect(g).connect(v.g);
    src.start(ctx.currentTime, desde);
    src.stop(ctx.currentTime + dur + 0.3);
  }

  function cerrar(s, fundido) {
    const t = ctx.currentTime;
    s.master.gain.setTargetAtTime(0, t, Math.max(0.01, fundido / 3));
    setTimeout(() => {
      for (const v of s.voces) { try { v.loop?.stop(); } catch { /* ya detenido */ } v.g.disconnect(); }
      s.master.disconnect();
    }, fundido * 1000 + 300);
  }

  function detener() {
    if (!sesion) return;
    cerrar(sesion, 0.25);
    sesion = null;
    if (pedido != null) cancelAnimationFrame(pedido);
    pedido = null;
    CAMPO.fijarReloj(null);
  }

  window.MOTOR = {
    sonar,
    detener,
    sonando: () => !!sesion,
    kamiSonando: () => sesion?.kami ?? null,
    resumenArchivos,
    dbGeneral,
  };
})();
