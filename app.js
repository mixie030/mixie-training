// Mixie Training — app de una sola página, sin dependencias. Datos en localStorage del móvil.
(() => {
  const D = window.MIXIE;
  const KEY = 'mixie.v1';
  const $main = document.getElementById('main');
  const $nav = document.getElementById('nav');
  const $sheet = document.getElementById('sheet');
  const $toast = document.getElementById('toast');

  // ---------- estado ----------
  const defaults = () => ({
    settings: {
      name: '', restBig: 60, restSmall: 45, restCore: 30, restLight: 30, sound: true,
      travelStart: D.PLAN.travelStart, travelEnd: D.PLAN.travelEnd,
    },
    overrides: {}, // fecha -> rutina o tipo de día que sustituye al plan
    logs: [],      // sesiones y actividades registradas
    checkins: {},  // fecha -> cómo me encuentro
    userMedia: {}, // ejercicio -> enlace propio a un vídeo
    active: null,  // sesión en curso
    dismissed: {}, // avisos cerrados
  });

  let S = load();
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const s = Object.assign(defaults(), JSON.parse(raw));
        s.settings = Object.assign(defaults().settings, s.settings);
        return s;
      }
    } catch (e) {}
    return defaults();
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { toast('No se pudo guardar'); }
  }
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

  // ---------- utilidades ----------
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const pad = (n) => String(n).padStart(2, '0');
  const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parse = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
  const todayKey = () => keyOf(new Date());
  const addDays = (k, n) => { const d = parse(k); d.setDate(d.getDate() + n); return keyOf(d); };
  const mondayOf = (k) => { const d = parse(k); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return keyOf(d); };
  const DOW = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const fmtLong = (k) => { const d = parse(k); return `${DOW[d.getDay()]} ${d.getDate()} de ${MONTHS[d.getMonth()]}`; };
  const fmtShort = (k) => { const d = parse(k); return `${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}`; };
  const fmtClock = (ms) => { const t = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(t / 60)}:${pad(t % 60)}`; };

  function toast(msg) {
    $toast.textContent = msg;
    $toast.classList.add('show');
    clearTimeout(toast.t);
    toast.t = setTimeout(() => $toast.classList.remove('show'), 2400);
  }
  function openSheet(html) {
    $sheet.innerHTML = `<div class="sheet-backdrop" data-action="close-sheet"></div><div class="sheet-panel" role="dialog" aria-modal="true"><div class="sheet-grip"></div>${html}</div>`;
    $sheet.classList.add('open');
  }
  function closeSheet() { $sheet.classList.remove('open'); $sheet.innerHTML = ''; }

  // ---------- vídeos propios (solo en este móvil, IndexedDB) ----------
  const userVideos = new Map(); // ejercicio -> { url, isImage } (vídeo o foto guardados en el móvil)
  function openDB() {
    return new Promise((res, rej) => {
      const r = indexedDB.open('mixie-media', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('videos');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  async function videoStore(mode, fn) {
    const db = await openDB();
    return new Promise((res, rej) => {
      const tx = db.transaction('videos', mode);
      fn(tx.objectStore('videos'));
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  }
  async function loadUserVideos() {
    try {
      await videoStore('readonly', (st) => {
        st.openCursor().onsuccess = (e) => {
          const c = e.target.result;
          if (!c) return;
          userVideos.set(c.key, { url: URL.createObjectURL(c.value), isImage: /^image\//.test(c.value.type) });
          c.continue();
        };
      });
      if (userVideos.size) render();
    } catch (e) {}
  }
  async function saveUserVideo(exId, file) {
    await videoStore('readwrite', (st) => st.put(file, exId));
    if (userVideos.has(exId)) URL.revokeObjectURL(userVideos.get(exId).url);
    userVideos.set(exId, { url: URL.createObjectURL(file), isImage: /^image\//.test(file.type) });
  }
  async function deleteUserVideo(exId) {
    await videoStore('readwrite', (st) => st.delete(exId));
    if (userVideos.has(exId)) URL.revokeObjectURL(userVideos.get(exId).url);
    userVideos.delete(exId);
  }

  // ---------- plan ----------
  const isTravel = (k) => k >= S.settings.travelStart && k <= S.settings.travelEnd;
  const basePlan = (k) => (isTravel(k) ? 'travel' : D.BASE_WEEK[parse(k).getDay()]);
  const planFor = (k) => S.overrides[k] || basePlan(k);
  function setPlan(k, id) {
    if (id === basePlan(k)) delete S.overrides[k];
    else S.overrides[k] = id;
  }
  function entry(id) {
    if (D.WORKOUTS[id]) return Object.assign({ id, isWorkout: true }, D.WORKOUTS[id]);
    return Object.assign({ id }, D.DAY_TYPES[id]);
  }
  const logsOn = (k) => S.logs.filter((l) => l.date === k);
  const isOptional = (k) => !S.overrides[k] && !isTravel(k) && D.OPTIONAL_DAYS.includes(parse(k).getDay());
  const hasSkateSlot = (k) => !isTravel(k) && parse(k).getDay() === D.SKATE_SLOT.day;

  function logTitle(l) {
    if (l.type === 'session') return D.WORKOUTS[l.workoutId]?.name || 'Sesión';
    if (l.type === 'walk') return `Paseo · ${l.minutes} min`;
    if (l.type === 'skate') return `Patinaje${l.minutes ? ` · ${l.minutes} min` : ''}`;
    if (l.type === 'shoot') return 'Día de rodaje / descanso';
    return 'Actividad';
  }

  function weekStats(mon) {
    const days = [...Array(7)].map((_, i) => addDays(mon, i));
    const logs = S.logs.filter((l) => days.includes(l.date));
    const st = { fuerza: 0, cardio: 0, movilidad: 0, patinaje: 0, descanso: 0 };
    logs.forEach((l) => {
      if (l.type === 'session') {
        const w = D.WORKOUTS[l.workoutId];
        if (!w || !l.done) return;
        const strengthDone = (l.steps || []).some((x) => x.status === 'done' && ['fuerza', 'core'].includes(D.EXERCISES[x.ex]?.category));
        if (w.kind === 'fuerza' && strengthDone) st.fuerza++;
        if (w.kind === 'patinaje') st.patinaje++;
        st.cardio += l.cardioMinutes || 0;
        if (l.mobility) st.movilidad++;
      } else if (l.type === 'walk') st.cardio += l.minutes || 0;
      else if (l.type === 'skate') st.patinaje++;
    });
    const t = todayKey();
    // Días pasados sin actividad (desde el inicio del plan) y hoy solo si se ha marcado como rodaje/descanso.
    st.descanso = days.filter((k) => k >= D.PLAN.start
      && (k < t || logs.some((l) => l.date === k && l.type === 'shoot'))
      && !logs.some((l) => l.date === k && l.type !== 'shoot')).length;
    return st;
  }
  const goalsFor = (k) => (isTravel(k)
    ? { fuerza: 2, cardio: 60, movilidad: 3, patinaje: 0 }
    : { fuerza: 2, cardio: 50, movilidad: 3, patinaje: 0 });

  function weekGoal(k) {
    if (k > S.settings.travelEnd) return 'Periodo inicial terminado. Buen momento para revisar el plan y ver qué ha funcionado.';
    if (isTravel(k)) return 'Moverte un poco cada semana, sin presión. Rodajes y jornadas largas cuentan como descanso.';
    const w = Math.floor((parse(mondayOf(k)) - parse(mondayOf(D.PLAN.start))) / (7 * 864e5)) + 1;
    if (w <= 2) return 'Aprender la técnica con poco peso. Sin prisas.';
    if (w <= 4) return 'Repetir lo aprendido. Si algo te sale fácil y sin molestias, puedes subir un poco.';
    return 'Mantener la rutina y llegar al viaje con buenas sensaciones.';
  }

  function exerciseHistory(exId) {
    const out = [];
    S.logs.forEach((l) => {
      if (l.type !== 'session') return;
      const steps = (l.steps || []).filter((s) => s.ex === exId);
      if (!steps.length) return;
      const weights = steps.flatMap((s) => s.weights || []).filter((w) => w != null && !isNaN(w));
      const complete = steps.every((s) => s.status === 'done' && s.setsDone >= s.sets);
      const stopped = steps.some((s) => s.status === 'stopped');
      const feels = steps.flatMap((s) => s.feels || []).filter(Boolean);
      out.push({ date: l.date, weights, complete, stopped, feels });
    });
    return out.sort((a, b) => (a.date < b.date ? -1 : 1));
  }
  const lastWeight = (exId) => {
    const h = exerciseHistory(exId).filter((x) => x.weights.length);
    return h.length ? h[h.length - 1].weights[h[h.length - 1].weights.length - 1] : null;
  };
  function progressHint(exId) {
    if (!D.EXERCISES[exId].load) return null;
    const h = exerciseHistory(exId);
    const lastFeel = h.length ? h[h.length - 1].feels.slice(-1)[0] : null;
    if (lastFeel === 'many') return 'La última vez te sobraban repeticiones con este peso: puedes probar a subir un poco.';
    if (lastFeel === 'none') return 'La última vez te costó mucho: empieza con algo menos de peso.';
    if (h.length < 2) return null;
    const [a, b] = h.slice(-2);
    if (a.complete && b.complete && !a.stopped && !b.stopped) {
      return 'Las dos últimas veces completaste todas las series sin molestias. Si hoy te sientes bien, puedes probar a subir un poco el peso. Si no, igual está perfecto.';
    }
    return null;
  }

  // ---------- piezas de interfaz ----------
  const ICONS = {
    hoy: '<path d="M4 11.5 12 5l8 6.5V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z"/>',
    semana: '<rect x="4" y="5.5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3.5v4M15 3.5v4"/>',
    rutinas: '<path d="M8 6h12M8 12h12M8 18h12"/><circle cx="4.5" cy="6" r=".8"/><circle cx="4.5" cy="12" r=".8"/><circle cx="4.5" cy="18" r=".8"/>',
    ejercicios: '<path d="M3 12h2M19 12h2M5 8.5v7M19 8.5v7M7.5 7v10M16.5 7v10M7.5 12h9"/>',
    progreso: '<path d="M4 19.5h16M7 16v-4M12 16V8M17 16v-6"/>',
  };
  const icon = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;
  const KIND_LABEL = { fuerza: 'Fuerza', cardio: 'Cardio', movilidad: 'Movilidad', patinaje: 'Patinaje', descanso: 'Descanso', viaje: 'Viaje' };

  function targetText(it) {
    const side = it.perSide ? ' por lado' : '';
    if (it.unit === 'min') return `${it.minutes} min`;
    if (it.unit === 'secs') return `${it.secs} s${side}`;
    return `${it.reps} reps${side}`;
  }
  const itemText = (it) => (it.sets > 1 ? `${it.sets} × ${targetText(it)}` : targetText(it));

  function placeholderHTML(small) {
    return `<div class="media-ph${small ? ' small' : ''}" aria-label="Demostración pendiente">
      <svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="14" r="6"/><path d="M32 22v18M32 28l-11 7M32 28l11 7M32 40l-8 15M32 40l8 15"/></svg>
      ${small ? '' : '<span>Demostración pendiente</span>'}
    </div>`;
  }
  function mediaHTML(exId, opts = {}) {
    const m = (D.MEDIA || {})[exId];
    const mine = userVideos.get(exId);
    if (mine) {
      if (opts.small) return mine.isImage ? `<img class="thumb" src="${mine.url}" alt="">` : '<span class="thumb thumb-video" aria-hidden="true">▶</span>';
      return `<figure class="media ${mine.isImage ? 'image' : 'video'}" data-media>
        <div class="media-stage">${mine.isImage ? `<img src="${mine.url}" alt="${esc(D.EXERCISES[exId].name)}">` : `<video src="${mine.url}" autoplay loop muted playsinline></video>`}</div>
        <div class="media-ctrl">
          ${mine.isImage ? '' : '<button class="chip" data-action="media-pause">Pausa</button>'}
          <button class="chip" data-action="media-zoom">Ampliar</button>
        </div>
        <figcaption>Tu ${mine.isImage ? 'foto' : 'vídeo'} · guardado solo en este móvil</figcaption>
      </figure>`;
    }
    if ((D.NO_DEMO || []).includes(exId)) return '';
    if (m && m.type === 'link') {
      if (opts.small) return placeholderHTML(true);
      return `${placeholderHTML(false)}<p class="media-hint"><a href="${esc(m.link)}" target="_blank" rel="noopener">Ver vídeo original ↗</a> (necesita conexión)</p>`;
    }
    const yt = (D.VIDEOS || {})[exId];
    if (!m && yt) {
      if (opts.small) return `<img class="thumb" src="https://i.ytimg.com/vi/${esc(yt.youtube)}/mqdefault.jpg" alt="" loading="lazy" data-fallback>`;
      const id = encodeURIComponent(yt.youtube);
      return `<figure class="media video-embed">
        <div class="media-stage wide"><iframe src="https://www.youtube-nocookie.com/embed/${id}?autoplay=1&mute=1&loop=1&playlist=${id}&playsinline=1&rel=0&modestbranding=1" title="${esc(D.EXERCISES[exId].name)}: vídeo de demostración" allow="autoplay; encrypted-media; picture-in-picture" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe></div>
        <p class="media-note">Necesita conexión. Si no carga, <a href="https://www.youtube.com/watch?v=${id}" target="_blank" rel="noopener">ábrelo en YouTube ↗</a></p>
        <figcaption>${esc(yt.credit)}</figcaption>
      </figure>`;
    }
    if (!m) return placeholderHTML(opts.small);
    if (opts.small) {
      const src = m.type === 'pair' ? m.frames[0] : (m.poster || m.src);
      return src ? `<img class="thumb" src="${esc(src)}" alt="" loading="lazy" data-fallback>` : placeholderHTML(true);
    }
    let inner = '';
    if (m.type === 'pair') {
      inner = `<img src="${esc(m.frames[0])}" alt="${esc(D.EXERCISES[exId].name)}: posición inicial" data-fallback>
               <img class="f2" src="${esc(m.frames[1])}" alt="${esc(D.EXERCISES[exId].name)}: posición final" data-fallback>`;
    } else if (m.type === 'video') {
      inner = `<video src="${esc(m.src)}" ${m.poster ? `poster="${esc(m.poster)}"` : ''} autoplay loop muted playsinline></video>`;
    } else {
      inner = `<img src="${esc(m.src)}" alt="${esc(D.EXERCISES[exId].name)}" data-fallback>`;
    }
    return `<figure class="media ${m.type}" data-media${m.link ? ` data-link="${esc(m.link)}"` : ''}>
      <div class="media-stage${m.tall ? ' tall' : ''}">${inner}</div>
      <div class="media-ctrl">
        ${m.type === 'pair' || m.type === 'video' ? '<button class="chip" data-action="media-pause">Pausa</button>' : ''}
        <button class="chip" data-action="media-zoom">Ampliar</button>
      </div>
      ${m.note ? `<p class="media-note">${esc(m.note)}</p>` : ''}
      ${m.link ? '<p class="media-hint">Doble toque: ver vídeo original ↗</p>' : ''}
      ${!m.link && (D.VIDEOS || {})[exId] ? `<p class="media-note">Vídeo completo (con conexión): <a href="https://www.youtube.com/watch?v=${encodeURIComponent(D.VIDEOS[exId].youtube)}" target="_blank" rel="noopener">verlo en YouTube ↗</a></p>` : ''}
      ${m.credit ? `<figcaption>${esc(m.credit)}</figcaption>` : ''}
    </figure>`;
  }

  function dots(n, goal) {
    if (!goal) return `<span class="count">${n}</span>`;
    let h = '';
    for (let i = 0; i < Math.max(goal, n); i++) h += `<i class="dot${i < n ? ' on' : ''}"></i>`;
    return `<span class="dots">${h}</span>`;
  }

  function statsHTML(mon, k) {
    const st = weekStats(mon), g = goalsFor(k);
    const pct = Math.min(100, Math.round((st.cardio / g.cardio) * 100));
    return `<div class="stats">
      <div class="stat"><span class="stat-label">Fuerza</span>${dots(st.fuerza, g.fuerza)}</div>
      <div class="stat"><span class="stat-label">Cardio y paseos</span><span class="bar"><i style="width:${pct}%"></i></span><span class="stat-sub">${st.cardio} min</span></div>
      <div class="stat"><span class="stat-label">Movilidad</span>${dots(st.movilidad, g.movilidad)}</div>
      <div class="stat"><span class="stat-label">Patinaje</span>${dots(st.patinaje, g.patinaje)}</div>
      <div class="stat"><span class="stat-label">Descanso</span><span class="count">${st.descanso} ${st.descanso === 1 ? 'día' : 'días'}</span></div>
    </div>`;
  }

  const physioNote = () => `<div class="callout">
    <strong>La rutina no sustituye una valoración de fisioterapia.</strong>
    Por las molestias de espalda alta, conviene una valoración presencial antes de progresar cargas o ejercicios que provoquen síntomas.
  </div>`;

  // ---------- vistas ----------
  function viewHoy() {
    const k = todayKey();
    const id = planFor(k), e = entry(id);
    const logs = logsOn(k);
    const msg = D.MESSAGES[Math.floor(parse(k) / 864e5) % D.MESSAGES.length];
    const name = S.settings.name ? `, ${esc(S.settings.name)}` : '';
    const a = S.active;

    let resume = '';
    if (a && a.phase !== 'overview') {
      const w = D.WORKOUTS[a.workoutId];
      const done = a.steps.filter((s) => s.status !== 'pending').length;
      resume = `<div class="card resume">
        <div><span class="eyebrow">Sesión a medias</span><h3>${esc(w.name)}</h3><p class="muted">${done} de ${a.steps.length} ejercicios</p></div>
        <div class="row"><a class="btn primary" href="#/sesion">Continuar</a><button class="btn ghost" data-action="discard-session">Descartar</button></div>
      </div>`;
    }

    let actions = '';
    if (e.isWorkout) {
      actions = `<button class="btn primary big" data-action="start" data-w="${id}">Empezar entrenamiento</button>
        <div class="row"><a class="btn ghost" href="#/rutina/${id}">Ver rutina</a><button class="btn ghost" data-action="day" data-k="${k}">Cambiar</button></div>`;
    } else if (id === 'skate') {
      actions = `<button class="btn primary big" data-action="log-skate" data-k="${k}">Patiné hoy</button>
        <div class="row"><button class="btn ghost" data-action="start" data-w="patinaje-prep">Preparación fuera del hielo</button><button class="btn ghost" data-action="day" data-k="${k}">Cambiar</button></div>`;
    } else if (id === 'travel') {
      actions = `<div class="choice-grid">
        <button class="choice" data-action="start" data-w="casa"><b>Fuerza en casa</b><span>10–30 min</span></button>
        <button class="choice" data-action="log-walk" data-k="${k}"><b>Paseo</b><span>registrar minutos</span></button>
        <button class="choice" data-action="start" data-w="flex"><b>Flexibilidad</b><span>10–15 min</span></button>
        <button class="choice" data-action="start" data-w="postural"><b>Postura</b><span>8–10 min</span></button>
        <button class="choice" data-action="log-skate" data-k="${k}"><b>Patiné hoy</b><span>registrar</span></button>
        <button class="choice" data-action="log-shoot" data-k="${k}"><b>Día de rodaje</b><span>descanso</span></button>
      </div>`;
    } else {
      actions = `<div class="row"><button class="btn primary" data-action="log-walk" data-k="${k}">Registrar paseo</button><button class="btn ghost" data-action="start" data-w="postural">Movilidad 8 min</button></div>
        <div class="row"><button class="btn ghost" data-action="day" data-k="${k}">Cambiar el día</button></div>`;
    }

    const doneNote = logs.length
      ? `<div class="done-note">✓ Hoy: ${logs.map((l) => esc(logTitle(l))).join(' · ')}</div>` : '';

    const nextK = addDays(k, 1), ne = entry(planFor(nextK));
    const mon = mondayOf(k);

    return `<header class="top">
        <p class="date">${fmtLong(k)}</p>
        <h1>Hola${name}</h1>
        <p class="msg">${esc(msg)}</p>
      </header>
      ${isTravel(k) ? '<div class="pill travel">Modo viaje · Argentina</div>' : ''}
      ${resume}
      <section class="card today ${e.kind || ''}">
        <span class="eyebrow">Hoy · ${isOptional(k) ? 'Opcional' : esc(KIND_LABEL[e.kind] || '')}</span>
        <h2>${esc(e.name)}</h2>
        ${e.tag ? `<p class="muted">${esc(e.tag)} · ${esc(e.duration)}</p>` : `<p class="muted">${esc(e.text || '')}</p>`}
        ${e.goal ? `<p>${esc(e.goal)}</p>` : ''}
        ${isOptional(k) ? '<p class="muted">Es un día extra: si te apetece, genial. Si no, no pasa nada.</p>' : ''}
        ${actions}
        ${hasSkateSlot(k) && !logs.some((l) => l.type === 'skate') ? `<div class="skate-note"><span>${esc(D.SKATE_SLOT.text)}</span><button class="btn ghost" data-action="log-skate" data-k="${k}">Patiné hoy</button></div>` : ''}
        ${doneNote}
      </section>
      <section class="card">
        <span class="eyebrow">Mañana</span>
        <p class="next"><b>${esc(ne.name)}</b> <span class="muted">${esc(ne.duration || '')}${isOptional(nextK) ? ' · opcional' : ''}</span></p>
      </section>
      <section class="card">
        <div class="card-head"><span class="eyebrow">Esta semana</span><a class="link" href="#/semana">Ver semana</a></div>
        ${statsHTML(mon, k)}
        <p class="week-goal">${esc(weekGoal(k))}</p>
      </section>
      ${S.dismissed.physio ? '' : `<section class="dismissable">${physioNote()}<button class="link small" data-action="dismiss" data-d="physio">Entendido, ocultar</button></section>`}`;
  }

  function dayStatus(k) {
    const logs = logsOn(k);
    if (logs.some((l) => l.type === 'session' && l.status === 'done') || logs.some((l) => l.type === 'walk' || l.type === 'skate')) return '<span class="tag ok">Hecho</span>';
    if (logs.some((l) => l.type === 'session')) return '<span class="tag soft">Parcial</span>';
    if (logs.some((l) => l.type === 'shoot')) return '<span class="tag soft">Rodaje</span>';
    if (planFor(k) === 'skipped') return '<span class="tag soft">Saltado</span>';
    return '';
  }

  let weekOffset = 0;
  function viewSemana() {
    const t = todayKey();
    const mon = addDays(mondayOf(t), weekOffset * 7);
    const days = [...Array(7)].map((_, i) => addDays(mon, i));
    const rows = days.map((k) => {
      const e = entry(planFor(k));
      return `<button class="day${k === t ? ' is-today' : ''}${S.overrides[k] ? ' moved' : ''}" data-action="day" data-k="${k}">
        <span class="day-date"><b>${DOW[parse(k).getDay()].slice(0, 3)}</b><small>${parse(k).getDate()}</small></span>
        <span class="day-body"><b>${esc(e.name)}</b><small>${esc(e.tag ? `${e.tag} · ${e.duration}` : e.duration || '')}${isOptional(k) ? ' · opcional' : ''}${hasSkateSlot(k) ? ' · + patinaje 18:00' : ''}</small></span>
        <span class="day-status">${dayStatus(k)}</span>
      </button>`;
    }).join('');
    return `<header class="top"><h1>Semana</h1>
        <div class="week-nav">
          <button class="icon-btn" data-action="week" data-d="-1" aria-label="Semana anterior">‹</button>
          <span>${fmtShort(mon)} – ${fmtShort(addDays(mon, 6))}</span>
          <button class="icon-btn" data-action="week" data-d="1" aria-label="Semana siguiente">›</button>
        </div>
      </header>
      ${isTravel(mon) || isTravel(addDays(mon, 6)) ? '<div class="pill travel">Modo viaje: elige cada día lo que encaje</div>' : ''}
      <div class="days">${rows}</div>
      <p class="hint">Toca un día para moverlo, cambiarlo o saltarlo. No hace falta recuperar sesiones perdidas.</p>
      <section class="card">${statsHTML(mon, mon)}<p class="week-goal">${esc(weekGoal(mon))}</p></section>`;
  }

  function daySheet(k) {
    const id = planFor(k), e = entry(id);
    const isToday = k === todayKey();
    const logs = logsOn(k);
    const mon = mondayOf(k);
    const options = [...Object.keys(D.WORKOUTS), 'rest-walk', 'skate', 'rest', 'shoot']
      .filter((o) => o !== id)
      .map((o) => `<button class="chip" data-action="set-day" data-k="${k}" data-id="${o}">${esc(entry(o).name)}</button>`).join('');
    const moveTo = [...Array(7)].map((_, i) => addDays(mon, i)).filter((d) => d !== k)
      .map((d) => `<button class="chip" data-action="move-day" data-k="${k}" data-to="${d}">${DOW[parse(d).getDay()].slice(0, 3)} ${parse(d).getDate()}</button>`).join('');
    return `<h3>${fmtLong(k)}</h3>
      <p class="muted">${esc(e.name)}${e.duration ? ` · ${esc(e.duration)}` : ''}</p>
      ${logs.length ? `<div class="done-note">✓ ${logs.map((l) => esc(logTitle(l))).join(' · ')}</div>` : ''}
      ${e.isWorkout ? `<button class="btn primary big" data-action="start" data-w="${id}">${isToday ? 'Empezar' : 'Hacer esta rutina hoy'}</button>` : ''}
      ${e.isWorkout ? `<a class="btn ghost" href="#/rutina/${id}" data-action="close-sheet-nav">Ver rutina</a>` : ''}
      <div class="row">
        <button class="btn ghost" data-action="log-walk" data-k="${k}">Paseo</button>
        <button class="btn ghost" data-action="log-skate" data-k="${k}">Patinaje</button>
      </div>
      <h4>Mover a otro día (intercambia)</h4><div class="chips">${moveTo}</div>
      <h4>Cambiar por</h4><div class="chips">${options}</div>
      <div class="row">
        ${id !== 'skipped' ? `<button class="btn ghost" data-action="set-day" data-k="${k}" data-id="skipped">Saltar este día</button>` : ''}
        ${S.overrides[k] ? `<button class="btn ghost" data-action="reset-day" data-k="${k}">Volver al plan</button>` : ''}
      </div>`;
  }

  function viewRutinas() {
    const order = ['piernas', 'espalda', 'cardio-postura', 'cardio-flex', 'patinaje-prep', 'flex', 'postural', 'casa'];
    return `<header class="top"><h1>Rutinas</h1><p class="msg">Tu semana base y las rutinas breves.</p></header>
      <div class="list">${order.map((id) => {
        const w = D.WORKOUTS[id];
        return `<a class="card link-card" href="#/rutina/${id}">
          <span class="eyebrow">${esc(w.tag)} · ${esc(KIND_LABEL[w.kind])}</span>
          <h3>${esc(w.name)}</h3><p class="muted">${esc(w.duration)} · ${w.circuit ? `${w.items.length} ejercicios en circuito` : `${w.items.length} ejercicios`}</p>
        </a>`;
      }).join('')}</div>`;
  }

  function viewRutina(id) {
    const w = D.WORKOUTS[id];
    if (!w) return viewRutinas();
    return `<header class="top"><a class="back" href="#/rutinas">‹ Rutinas</a>
        <span class="eyebrow">${esc(w.tag)}</span><h1>${esc(w.name)}</h1>
        <p class="msg">${esc(w.duration)} · ${esc(w.goal)}</p></header>
      ${w.physio ? physioNote() : ''}
      <section class="card"><span class="eyebrow">Calentamiento</span><p>${esc(w.warmup)}</p></section>
      <section class="card">
        <span class="eyebrow">${w.circuit ? `Circuito · ${w.roundsChoice ? '1–2' : w.rounds} vueltas` : 'Ejercicios'}</span>
        <ul class="ex-list">${w.items.map((it) => {
          const ex = D.EXERCISES[it.ex];
          return `<li><a href="#/ejercicio/${it.ex}">${mediaHTML(it.ex, { small: true })}<span><b>${esc(it.label && it.label !== 'Movilidad final' ? it.label : ex.name)}</b><small>${it.label && it.label !== 'Movilidad final' ? `${esc(ex.name)} · ` : ''}${esc(itemText(it))}</small></span></a></li>`;
        }).join('')}</ul>
      </section>
      <section class="card"><span class="eyebrow">Técnica y seguridad</span><ul class="notes">${w.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul></section>
      <button class="btn primary big" data-action="start" data-w="${id}">Empezar ahora</button>`;
  }

  let exQuery = '';
  function viewEjercicios() {
    const q = exQuery.trim().toLowerCase();
    const groups = Object.keys(D.CATEGORIES).map((cat) => {
      const ids = Object.keys(D.EXERCISES).filter((id) => D.EXERCISES[id].category === cat && (!q || D.EXERCISES[id].name.toLowerCase().includes(q)));
      if (!ids.length) return '';
      return `<h4>${esc(D.CATEGORIES[cat])}</h4><ul class="ex-list">${ids.map((id) => `<li><a href="#/ejercicio/${id}">${mediaHTML(id, { small: true })}<span><b>${esc(D.EXERCISES[id].name)}</b><small>${esc(D.EXERCISES[id].purpose)}</small></span></a></li>`).join('')}</ul>`;
    }).join('');
    return `<header class="top"><h1>Ejercicios</h1></header>
      <input class="search" type="search" placeholder="Buscar ejercicio" value="${esc(exQuery)}" data-input="ex-search" autocomplete="off">
      <div id="ex-results">${groups || '<p class="muted">Ningún ejercicio coincide.</p>'}</div>`;
  }

  function exerciseBody(id) {
    const ex = D.EXERCISES[id];
    return `<section class="block"><h4>Para qué sirve</h4><p>${esc(ex.purpose)}</p></section>
      <section class="block"><h4>Posición inicial</h4><p>${esc(ex.start)}</p></section>
      <section class="block"><h4>Cómo hacerlo</h4><ol>${ex.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol></section>
      <section class="block"><h4>Errores habituales</h4><ul>${ex.mistakes.map((s) => `<li>${esc(s)}</li>`).join('')}</ul></section>
      <div class="callout soft"><strong>Seguridad.</strong> ${esc(ex.safety)}</div>`;
  }

  function viewEjercicio(id) {
    const ex = D.EXERCISES[id];
    if (!ex) return viewEjercicios();
    const usedIn = Object.keys(D.WORKOUTS).filter((w) => D.WORKOUTS[w].items.some((it) => it.ex === id));
    const hist = exerciseHistory(id).filter((h) => h.weights.length).slice(-5).reverse();
    const mine = S.userMedia[id];
    return `<header class="top"><a class="back" href="#/ejercicios" data-action="back">‹ Volver</a>
        <span class="eyebrow">${esc(D.CATEGORIES[ex.category])}</span><h1>${esc(ex.name)}</h1></header>
      ${mediaHTML(id)}
      ${exerciseBody(id)}
      ${hist.length ? `<section class="block"><h4>Tus últimas cargas</h4><ul class="plain">${hist.map((h) => `<li>${fmtShort(h.date)} · ${h.weights.join(' / ')} kg</li>`).join('')}</ul></section>` : ''}
      <section class="block"><h4>Tu vídeo o foto</h4>
        <p class="muted">Una grabación tuya, de la pantalla del móvil o una captura. Se guarda solo en este iPhone y funciona sin conexión. Consejo: recorta los vídeos en Fotos a 5–10 segundos.</p>
        <div class="row">
          <label class="btn ghost file">${userVideos.has(id) ? 'Cambiar' : 'Añadir vídeo o foto'}<input type="file" accept="video/*,image/*" data-input="user-video" data-ex="${id}" hidden></label>
          ${userVideos.has(id) ? `<button class="btn ghost" data-action="del-user-video" data-ex="${id}">Quitar</button>` : ''}
        </div>
      </section>
      <section class="block"><h4>Enlace de referencia</h4>
        ${mine ? `<p><a class="link" href="${esc(mine)}" target="_blank" rel="noopener">Abrir enlace ↗</a></p>` : '<p class="muted">También puedes guardar un enlace a un vídeo (necesita conexión).</p>'}
        <div class="row"><input type="url" id="my-media" placeholder="https://…" value="${esc(mine || '')}"><button class="btn ghost" data-action="save-media" data-ex="${id}">Guardar</button></div>
      </section>
      ${usedIn.length ? `<section class="block"><h4>Aparece en</h4><div class="chips">${usedIn.map((w) => `<a class="chip" href="#/rutina/${w}">${esc(D.WORKOUTS[w].name)}</a>`).join('')}</div></section>` : ''}`;
  }

  function viewProgreso() {
    const k = todayKey();
    const recent = [...S.logs].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 15);
    const loadEx = Object.keys(D.EXERCISES).filter((id) => D.EXERCISES[id].load)
      .map((id) => ({ id, h: exerciseHistory(id).filter((x) => x.weights.length) })).filter((x) => x.h.length);
    const pains = S.logs.flatMap((l) => (l.pains || []).map((p) => ({ date: l.date, ...p }))).slice(-8).reverse();
    const checks = Object.keys(S.checkins).sort().reverse().slice(0, 6);
    const best = Math.max(0, ...Object.values(S.checkins).map((c) => Number(c.balance) || 0));
    const today = S.checkins[k];
    return `<header class="top"><h1>Progreso</h1><p class="msg">Sin notas ni comparaciones: solo para ver cómo vas.</p></header>
      <section class="card">${statsHTML(mondayOf(k), k)}</section>
      <section class="card">
        <div class="card-head"><span class="eyebrow">Cómo estoy hoy</span>${today ? '<span class="tag ok">Registrado</span>' : ''}</div>
        <p class="muted">Energía, descanso, molestias y equilibrio. Todo opcional.</p>
        <button class="btn ghost" data-action="checkin">${today ? 'Editar registro de hoy' : 'Registrar'}</button>
      </section>
      ${best ? `<section class="card"><span class="eyebrow">Equilibrio a una pierna</span><p class="big-num">${best} s <small>tu mejor marca</small></p></section>` : ''}
      <section class="card"><span class="eyebrow">Historial</span>
        ${recent.length ? `<ul class="history">${recent.map((l) => `<li><span>${fmtShort(l.date)}</span><b>${esc(logTitle(l))}</b>${l.type === 'session' ? `<small>${l.done}/${l.total} ejercicios${l.effort ? ` · ${esc(l.effort)}` : ''}</small>` : ''}${l.notes ? `<small class="note">${esc(l.notes)}</small>` : ''}<button class="link small" data-action="del-log" data-id="${l.id}">Borrar</button></li>`).join('')}</ul>` : '<p class="muted">Aún no hay nada registrado. Hoy es un buen día para empezar.</p>'}
      </section>
      ${loadEx.length ? `<section class="card"><span class="eyebrow">Cargas</span><ul class="history">${loadEx.map(({ id, h }) => `<li><b>${esc(D.EXERCISES[id].name)}</b><small>${h.slice(-3).map((x) => `${fmtShort(x.date)}: ${x.weights.join('/')} kg`).join(' · ')}</small></li>`).join('')}</ul></section>` : ''}
      ${pains.length ? `<section class="card"><span class="eyebrow">Molestias durante el entrenamiento</span><ul class="history">${pains.map((p) => `<li><span>${fmtShort(p.date)}</span><b>${esc(D.EXERCISES[p.ex]?.name || '')}</b><small>${esc(p.zone || 'sin especificar')}</small></li>`).join('')}</ul><p class="hint">Si una molestia se repite, coméntalo con fisioterapia.</p></section>` : ''}
      ${checks.length ? `<section class="card"><span class="eyebrow">Registros</span><ul class="history">${checks.map((d) => { const c = S.checkins[d]; return `<li><span>${fmtShort(d)}</span><small>${[c.energy && `Energía ${c.energy}`, c.sleep && `Descanso ${c.sleep}`, c.back && c.back !== 'nada' && `Espalda: ${c.back}`, c.shoulder && c.shoulder !== 'nada' && `Hombros: ${c.shoulder}`, c.balance && `Equilibrio ${c.balance} s`, c.leg && `Pierna: ${c.leg}`, c.weight && `${c.weight} kg`].filter(Boolean).map(esc).join(' · ')}</small>${c.note ? `<small class="note">${esc(c.note)}</small>` : ''}</li>`; }).join('')}</ul></section>` : ''}
      <a class="btn ghost" href="#/ajustes">Ajustes y copia de seguridad</a>`;
  }

  function checkinSheet() {
    const c = S.checkins[todayKey()] || {};
    const radio = (name, opts) => `<div class="chips" role="radiogroup">${opts.map((o) => `<label class="chip radio"><input type="radio" name="${name}" value="${o}" ${c[name] === o ? 'checked' : ''}><span>${o}</span></label>`).join('')}</div>`;
    return `<h3>Cómo estoy hoy</h3><form id="checkin-form">
      <h4>Energía</h4>${radio('energy', ['baja', 'normal', 'alta'])}
      <h4>Descanso</h4>${radio('sleep', ['mal', 'regular', 'bien'])}
      <h4>Molestias de espalda</h4>${radio('back', ['nada', 'leve', 'moderada', 'fuerte'])}
      <h4>Molestias de hombros</h4>${radio('shoulder', ['nada', 'leve', 'moderada', 'fuerte'])}
      <h4>Control al elevar la pierna</h4>${radio('leg', ['peor', 'igual', 'mejor'])}
      <div class="grid2">
        <label><h4>Equilibrio (s)</h4><input type="number" inputmode="numeric" name="balance" value="${esc(c.balance || '')}" placeholder="opcional"></label>
        <label><h4>Peso (kg)</h4><input type="number" inputmode="decimal" step="0.1" name="weight" value="${esc(c.weight || '')}" placeholder="opcional"></label>
      </div>
      <h4>Notas</h4><textarea name="note" rows="3" placeholder="Lo que quieras apuntar">${esc(c.note || '')}</textarea>
      ${c.back === 'fuerte' || c.shoulder === 'fuerte' ? '<div class="callout soft">Con molestias fuertes, mejor descansar hoy y consultarlo con fisioterapia.</div>' : ''}
      <button class="btn primary big" type="button" data-action="save-checkin">Guardar</button>
    </form>`;
  }

  function viewAjustes() {
    const s = S.settings;
    return `<header class="top"><a class="back" href="#/progreso">‹ Progreso</a><h1>Ajustes</h1></header>
      <section class="card form">
        <label><h4>Tu nombre (para el saludo)</h4><input type="text" data-setting="name" value="${esc(s.name)}" placeholder="opcional"></label>
        <h4>Descanso entre series (segundos)</h4>
        <div class="grid2">
          <label><h4>Ejercicios grandes</h4><input type="number" inputmode="numeric" data-setting="restBig" value="${s.restBig}"></label>
          <label><h4>Máquinas pequeñas</h4><input type="number" inputmode="numeric" data-setting="restSmall" value="${s.restSmall}"></label>
          <label><h4>Core</h4><input type="number" inputmode="numeric" data-setting="restCore" value="${s.restCore}"></label>
          <label><h4>Estiramientos y circuitos</h4><input type="number" inputmode="numeric" data-setting="restLight" value="${s.restLight}"></label>
        </div>
        <p class="hint">Grandes: prensa, peso muerto rumano, step-up, remo y jalón. Pequeñas: curl femoral, abductores, gemelos y reverse pec deck. Core: dead bug y Pallof press. Descansa hasta respirar con normalidad: usa ±15 s si lo necesitas.</p>
        <label class="switch"><input type="checkbox" data-setting="sound" ${s.sound ? 'checked' : ''}><span>Sonido al terminar el descanso</span></label>
      </section>
      <section class="card form"><span class="eyebrow">Modo viaje</span>
        <div class="grid2">
          <label><h4>Desde</h4><input type="date" data-setting="travelStart" value="${s.travelStart}"></label>
          <label><h4>Hasta</h4><input type="date" data-setting="travelEnd" value="${s.travelEnd}"></label>
        </div>
      </section>
      <section class="card"><span class="eyebrow">Copia de seguridad</span>
        <p class="muted">Tus datos solo están en este móvil. Haz una copia de vez en cuando (por ejemplo, a Archivos o iCloud Drive). Tus vídeos y fotos de ejercicios no entran en la copia: guárdalos también en Fotos.</p>
        <div class="row"><button class="btn ghost" data-action="export">Exportar copia</button><label class="btn ghost file">Importar<input type="file" accept="application/json,.json" data-input="import" hidden></label></div>
      </section>
      <section class="card"><span class="eyebrow">Demostraciones</span>
        <p class="muted">${esc(D.MEDIA_CREDITS || 'Las demostraciones se irán añadiendo cuando estén revisadas.')}</p></section>
      ${physioNote()}
      <button class="link small danger" data-action="reset-all">Borrar todos los datos</button>`;
  }

  // ---------- sesión ----------
  function buildSteps(w, rounds) {
    const mk = (it, round) => ({
      ex: it.ex, label: it.label || '', unit: it.unit, sets: it.sets || 1, reps: it.reps, secs: it.secs, minutes: it.minutes,
      perSide: !!it.perSide, round, setsDone: 0, weights: [], status: 'pending', minutesDone: 0, timer: null,
    });
    if (w.circuit) {
      const out = [];
      for (let r = 1; r <= rounds; r++) w.items.forEach((it) => out.push(mk(it, r)));
      return out;
    }
    return w.items.map((it) => mk(it, 0));
  }
  const segments = (s) => {
    if (s.unit === 'min') return [{ t: '', s: s.minutes * 60 }];
    if (s.perSide) return [{ t: 'Lado 1', s: s.secs }, { t: 'Cambia de lado', s: 5 }, { t: 'Lado 2', s: s.secs }];
    return [{ t: '', s: s.secs }];
  };
  function restFor(s) {
    if (D.WORKOUTS[S.active.workoutId].circuit) return S.settings.restLight;
    const g = D.REST_GROUPS;
    if (g.big.includes(s.ex)) return S.settings.restBig;
    if (g.small.includes(s.ex)) return S.settings.restSmall;
    if (g.core.includes(s.ex)) return S.settings.restCore;
    return S.settings.restLight;
  }

  function startSession(id) {
    if (S.active && S.active.phase !== 'overview' && !confirm('Tienes una sesión a medias. ¿Descartarla y empezar otra?')) return;
    const w = D.WORKOUTS[id];
    S.active = { id: uid(), workoutId: id, phase: 'overview', rounds: w.rounds || 1, date: todayKey(), pains: [] };
    save();
    closeSheet();
    location.hash = '#/sesion';
  }

  function startRest(secs) {
    const a = S.active;
    a.phase = 'rest';
    a.restEndsAt = Date.now() + secs * 1000;
    save(); render();
  }
  function nextStep(withRest) {
    const a = S.active, cur = a.steps[a.idx];
    const ni = a.steps.findIndex((s, i) => i > a.idx && s.status === 'pending');
    const fallback = ni === -1 ? a.steps.findIndex((s) => s.status === 'pending') : ni;
    if (fallback === -1) { a.phase = 'summary'; save(); render(); return; }
    a.idx = fallback;
    a.lastFeel = null;
    const next = a.steps[fallback];
    if (withRest && D.WORKOUTS[a.workoutId].circuit && next.round === cur.round) return startRest(S.settings.restLight);
    if (withRest && D.WORKOUTS[a.workoutId].circuit && next.round !== cur.round) return startRest(60);
    a.phase = 'exercise';
    save(); render();
  }
  const FEEL_TIP = {
    many: 'Te sobraba bastante: sube un poco en la siguiente serie.',
    ok: 'Perfecto: mantén este peso.',
    none: 'Ha costado mucho: baja un poco en la siguiente serie.',
  };
  const FEEL_NEXT = { many: 'Anotado: la próxima vez puedes subir un poco.', ok: 'Anotado: peso correcto.', none: 'Anotado: la próxima vez, un poco menos de peso.' };
  // Ejercicios con peso: antes de cerrar la serie se pregunta cuántas repeticiones más se podrían haber hecho.
  function askFeel() {
    const a = S.active, s = a.steps[a.idx];
    if (!D.EXERCISES[s.ex].load || s.unit !== 'reps') return completeSet(null);
    a.pendingWeight = document.getElementById('weight')?.value ?? '';
    save();
    openSheet(feelSheet());
  }
  function completeSet(feel) {
    const a = S.active, s = a.steps[a.idx], ex = D.EXERCISES[s.ex];
    if (ex.load) {
      const v = a.pendingWeight ?? document.getElementById('weight')?.value;
      const n = v ? Number(String(v).replace(',', '.')) : null;
      s.weights.push(n != null && !isNaN(n) ? n : null);
      delete a.pendingWeight;
    }
    s.feels = (s.feels || []).concat([feel || null]);
    a.lastFeel = feel || null;
    s.setsDone++;
    s.timer = null;
    if (s.setsDone < s.sets) return startRest(restFor(s));
    s.status = 'done';
    if (feel) toast(FEEL_NEXT[feel]);
    nextStep(true);
  }
  function feelSheet() {
    return `<h3>¿Cuántas más podrías haber hecho?</h3>
      <p class="muted">Con buena técnica. Así sabrás si el peso es el adecuado.</p>
      <div class="feel-options">
        <button class="choice" data-action="feel" data-v="many"><b>5 o más</b><span>Me sobraba bastante</span></button>
        <button class="choice" data-action="feel" data-v="ok"><b>2 o 3</b><span>Justo bien</span></button>
        <button class="choice" data-action="feel" data-v="none"><b>Ninguna</b><span>Ha costado mucho</span></button>
      </div>
      <button class="link small center" data-action="feel" data-v="">Saltar</button>`;
  }
  function advanceSegment(s, now) {
    const segs = segments(s), t = s.timer;
    const late = now - t.endsAt;
    if (late < 1500) beep();
    t.seg++;
    if (t.seg < segs.length) {
      t.endsAt += segs[t.seg].s * 1000;
      t.remaining = segs[t.seg].s * 1000;
      save(); render();
    } else {
      if (s.unit === 'min') s.minutesDone = s.minutes;
      completeSet(null);
    }
  }

  function viewSesion() {
    const a = S.active;
    if (!a) { location.hash = '#/hoy'; return ''; }
    const w = D.WORKOUTS[a.workoutId];
    if (a.phase === 'overview') {
      const steps = buildSteps(w, a.rounds);
      return `<div class="session">
        <div class="s-top"><button class="icon-btn" data-action="cancel-session" aria-label="Cancelar">✕</button><span>${esc(w.tag)}</span><span></span></div>
        <h1>${esc(w.name)}</h1><p class="msg">${esc(w.duration)} · ${esc(w.goal)}</p>
        ${w.physio ? physioNote() : ''}
        <section class="card"><span class="eyebrow">Antes de empezar</span><p>${esc(w.warmup)}</p><ul class="notes">${w.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul></section>
        ${w.roundsChoice ? `<section class="card"><span class="eyebrow">¿Cuánto tiempo tienes?</span><div class="chips">
          <button class="chip${a.rounds === 1 ? ' on' : ''}" data-action="rounds" data-n="1">10 min · 1 vuelta</button>
          <button class="chip${a.rounds === 2 ? ' on' : ''}" data-action="rounds" data-n="2">Completa · 2 vueltas</button></div></section>` : ''}
        <p class="muted">${steps.length} pasos${w.circuit ? ` · ${a.rounds} ${a.rounds === 1 ? 'vuelta' : 'vueltas'}` : ''}</p>
        <button class="btn primary big" data-action="begin">Empezar</button>
      </div>`;
    }
    if (a.phase === 'summary') return summaryView(a, w);

    const s = a.steps[a.idx], ex = D.EXERCISES[s.ex];
    const doneCount = a.steps.filter((x) => x.status !== 'pending').length;
    const top = `<div class="s-top">
        <a class="icon-btn" href="#/hoy" aria-label="Salir y continuar luego">✕</a>
        <span>Ejercicio ${Math.min(doneCount + 1, a.steps.length)} de ${a.steps.length}</span>
        <button class="icon-btn" data-action="step-list" aria-label="Lista de ejercicios">☰</button>
      </div><div class="progress"><i style="width:${(doneCount / a.steps.length) * 100}%"></i></div>`;

    if (a.phase === 'rest') {
      const left = a.restEndsAt - Date.now();
      const isNewStep = s.setsDone === 0;
      return `<div class="session rest">${top}
        <span class="eyebrow">${isNewStep ? 'Descanso · cambio de ejercicio' : `Descanso antes de la serie ${s.setsDone + 1}`}</span>
        <div class="clock" data-clock>${fmtClock(left)}</div>
        <div class="row center"><button class="btn ghost" data-action="rest-add" data-d="-15">−15 s</button><button class="btn ghost" data-action="rest-add" data-d="15">+15 s</button></div>
        ${!isNewStep && a.lastFeel ? `<div class="callout feel-tip">${esc(FEEL_TIP[a.lastFeel])}</div>` : ''}
        <p class="muted center">A continuación: <b>${esc(ex.name)}</b>${isNewStep ? '' : ` · serie ${s.setsDone + 1} de ${s.sets}`}</p>
        <button class="btn primary big" data-action="rest-skip">Seguir ya</button>
      </div>`;
    }

    const roundTxt = s.round ? `Vuelta ${s.round} de ${a.rounds}` : (s.label || '');
    const setTxt = s.sets > 1 ? `Serie ${s.setsDone + 1} de ${s.sets}` : '';
    const hint = s.setsDone === 0 ? progressHint(s.ex) : null;
    let controls = '';
    if (s.unit === 'reps') {
      controls = `${ex.load ? `<label class="weight"><span>Peso (kg, opcional)</span><input id="weight" type="number" inputmode="decimal" step="0.5" value="${esc(s.weights.length ? (s.weights[s.weights.length - 1] ?? '') : (lastWeight(s.ex) ?? ''))}" placeholder="—"></label>` : ''}
        <button class="btn primary big" data-action="set-done">${s.sets > 1 ? 'Serie hecha' : 'Completar'}</button>`;
    } else {
      const segs = segments(s), t = s.timer;
      const seg = t ? segs[t.seg] : segs[0];
      const left = t ? (t.running ? t.endsAt - Date.now() : t.remaining) : seg.s * 1000;
      controls = `<div class="timer">
          ${seg.t ? `<span class="seg">${esc(seg.t)}</span>` : ''}
          <div class="clock" data-clock>${fmtClock(left)}</div>
        </div>
        ${t && t.running
          ? '<button class="btn ghost big" data-action="timer-pause">Pausa</button>'
          : `<button class="btn primary big" data-action="timer-start">${t ? 'Seguir' : 'Empezar'}</button>`}
        <button class="btn ghost wide" data-action="timer-done">${s.unit === 'min' ? 'Terminar ya' : 'Hecho'}</button>`;
    }
    return `<div class="session">${top}
      ${mediaHTML(s.ex)}
      <span class="eyebrow">${esc(roundTxt)}</span>
      <h1 class="ex-name">${esc(ex.name)}</h1>
      <p class="target"><b>${esc(targetText(s))}</b>${setTxt ? ` · ${setTxt}` : ''}</p>
      ${hint ? `<div class="callout soft">${esc(hint)}</div>` : ''}
      ${controls}
      <div class="row">
        <button class="btn ghost" data-action="skip">Omitir</button>
        <button class="btn warn" data-action="stop">Me molesta</button>
      </div>
      <details class="how"><summary>Cómo se hace</summary>${exerciseBody(s.ex)}</details>
      <button class="link small center" data-action="finish">Terminar la sesión aquí</button>
    </div>`;
  }

  function summaryView(a, w) {
    const c = (st) => a.steps.filter((s) => s.status === st).length;
    const icon = { done: '✓', skipped: '–', stopped: '!', pending: '·' };
    return `<div class="session">
      <div class="s-top"><span></span><span>Resumen</span><span></span></div>
      <h1>${c('done') === a.steps.length ? 'Sesión completa' : 'Sesión registrada'}</h1>
      <p class="msg">${esc(D.MESSAGES[Math.floor(Math.random() * D.MESSAGES.length)])}</p>
      <div class="summary-nums"><div><b>${c('done')}</b><small>hechos</small></div><div><b>${c('skipped') + c('pending')}</b><small>omitidos</small></div><div><b>${c('stopped')}</b><small>parados</small></div></div>
      <ul class="sum-list">${a.steps.map((s) => `<li class="${s.status}"><i>${icon[s.status]}</i>${esc(D.EXERCISES[s.ex].name)}${s.round ? ` <small>v${s.round}</small>` : ''}${s.weights.filter((x) => x != null).length ? ` <small>${s.weights.filter((x) => x != null).join('/')} kg</small>` : ''}</li>`).join('')}</ul>
      <h4>¿Cómo ha ido?</h4>
      <div class="chips">${['suave', 'bien', 'exigente', 'demasiado'].map((e) => `<button class="chip${a.effort === e ? ' on' : ''}" data-action="effort" data-v="${e}">${e}</button>`).join('')}</div>
      ${a.effort === 'demasiado' ? '<div class="callout soft">Gracias por decirlo. La próxima vez baja un poco el peso o haz menos series: la idea es que sea sostenible.</div>' : ''}
      <h4>Notas</h4><textarea id="session-notes" rows="3" placeholder="Pesos, sensaciones, lo que quieras">${esc(a.notes || '')}</textarea>
      <button class="btn primary big" data-action="save-session">Guardar</button>
      <button class="link small center" data-action="back-to-session">Volver a la sesión</button>
    </div>`;
  }

  function saveSession() {
    const a = S.active;
    const notes = document.getElementById('session-notes')?.value || '';
    const done = a.steps.filter((s) => s.status === 'done').length;
    const cardioMinutes = a.steps.filter((s) => s.ex === 'cardio' && s.label !== 'Calentamiento').reduce((t, s) => t + (s.minutesDone || 0), 0);
    const mobilityDone = a.steps.filter((s) => s.status === 'done' && ['movilidad', 'flexibilidad', 'postura'].includes(D.EXERCISES[s.ex].category)).length;
    S.logs.push({
      id: a.id, type: 'session', date: a.date, workoutId: a.workoutId,
      status: done === a.steps.length ? 'done' : 'partial',
      done, total: a.steps.length, effort: a.effort || '', notes: notes.trim(),
      pains: a.pains || [], cardioMinutes, mobility: mobilityDone >= 2,
      steps: a.steps.map((s) => ({ ex: s.ex, status: s.status, sets: s.sets, setsDone: s.setsDone, weights: s.weights, feels: s.feels || [], minutesDone: s.minutesDone, round: s.round })),
    });
    S.active = null;
    save();
    keepAwake(false);
    location.hash = '#/hoy';
    toast('Guardado. Bien hecho.');
  }

  function stopSheet() {
    const zones = ['espalda alta', 'zona lumbar', 'hombro', 'cuello', 'cadera', 'rodilla', 'otra'];
    return `<h3>Para aquí. No hace falta forzar.</h3>
      <p class="muted">¿Dónde lo notas? (opcional)</p>
      <div class="chips">${zones.map((z) => `<label class="chip radio"><input type="radio" name="zone" value="${z}"><span>${z}</span></label>`).join('')}</div>
      <button class="btn primary big" data-action="stop-skip">Saltar este ejercicio</button>
      <button class="btn ghost" data-action="stop-end">Terminar la sesión</button>
      <button class="btn ghost" data-action="close-sheet">Era momentáneo, sigo</button>
      <p class="hint">Si la molestia se repite o no se va, coméntalo con fisioterapia antes de volver a hacer este ejercicio.</p>`;
  }

  function stepListSheet() {
    const a = S.active;
    const label = { done: 'hecho', skipped: 'omitido', stopped: 'parado', pending: '' };
    return `<h3>Ejercicios</h3><ul class="step-list">${a.steps.map((s, i) => `<li><button data-action="jump" data-i="${i}" class="${i === a.idx ? 'cur' : ''}">
      <span>${esc(D.EXERCISES[s.ex].name)}${s.round ? ` · v${s.round}` : ''}</span><small>${label[s.status]}</small></button></li>`).join('')}</ul>`;
  }

  // ---------- registros rápidos ----------
  function quickLogSheet(type, k) {
    const title = type === 'walk' ? 'Paseo o cardio' : 'Patinaje';
    const presets = type === 'walk' ? [20, 30, 45, 60] : [30, 45, 60, 90];
    return `<h3>${title} · ${fmtShort(k)}</h3>
      <h4>Minutos</h4><div class="chips">${presets.map((m) => `<label class="chip radio"><input type="radio" name="mins" value="${m}"><span>${m}</span></label>`).join('')}</div>
      <input type="number" inputmode="numeric" id="mins-custom" placeholder="Otro (minutos)">
      <h4>Nota</h4><textarea id="quick-note" rows="2" placeholder="opcional"></textarea>
      <button class="btn primary big" data-action="save-quick" data-type="${type}" data-k="${k}">Guardar</button>`;
  }

  // ---------- sonido y pantalla ----------
  let actx = null;
  function unlockAudio() {
    try {
      if (!actx) {
        if (navigator.audioSession) navigator.audioSession.type = 'ambient';
        actx = new (window.AudioContext || window.webkitAudioContext)();
      }
      if (actx.state === 'suspended') actx.resume();
    } catch (e) {}
  }
  function beep() {
    if (!S.settings.sound || !actx) return;
    try {
      [0, 0.22].forEach((d) => {
        const o = actx.createOscillator(), g = actx.createGain(), t0 = actx.currentTime + d;
        o.frequency.value = 880;
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(0.25, t0 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.18);
        o.connect(g).connect(actx.destination);
        o.start(t0); o.stop(t0 + 0.2);
      });
    } catch (e) {}
  }
  let wakeLock = null;
  async function keepAwake(on) {
    try {
      if (on && 'wakeLock' in navigator && !wakeLock) {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => { wakeLock = null; });
      } else if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
    } catch (e) {}
  }

  function tick() {
    const a = S.active;
    if (!a || route().name !== 'sesion') return;
    const now = Date.now();
    const clock = document.querySelector('[data-clock]');
    if (a.phase === 'rest') {
      const left = a.restEndsAt - now;
      if (left <= 0) {
        if (left > -1500) beep();
        a.phase = 'exercise'; save(); render(); return;
      }
      if (clock) clock.textContent = fmtClock(left);
    } else if (a.phase === 'exercise') {
      const s = a.steps[a.idx], t = s.timer;
      if (t && t.running) {
        const left = t.endsAt - now;
        if (left <= 0) return advanceSegment(s, now);
        if (clock) clock.textContent = fmtClock(left);
      }
    }
  }
  setInterval(tick, 250);

  // ---------- acciones ----------
  const actions = {
    'close-sheet': closeSheet,
    'close-sheet-nav': closeSheet,
    back: () => { if (history.length > 1) history.back(); else location.hash = '#/ejercicios'; },
    dismiss: (el) => { S.dismissed[el.dataset.d] = true; save(); render(); },
    start: (el) => startSession(el.dataset.w),
    'discard-session': () => { if (confirm('¿Descartar la sesión a medias? No se guardará.')) { S.active = null; save(); render(); } },
    'cancel-session': () => { S.active = null; save(); location.hash = '#/hoy'; },
    rounds: (el) => { S.active.rounds = Number(el.dataset.n); save(); render(); },
    begin: () => {
      const a = S.active, w = D.WORKOUTS[a.workoutId];
      a.steps = buildSteps(w, a.rounds);
      a.idx = 0; a.phase = 'exercise'; a.startedAt = Date.now();
      save(); keepAwake(true); render();
    },
    'set-done': askFeel,
    feel: (el) => { closeSheet(); completeSet(el.dataset.v || null); },
    'timer-start': () => {
      const s = S.active.steps[S.active.idx];
      if (!s.timer) s.timer = { seg: 0, remaining: segments(s)[0].s * 1000, running: false };
      s.timer.running = true;
      s.timer.endsAt = Date.now() + s.timer.remaining;
      save(); render();
    },
    'timer-pause': () => {
      const t = S.active.steps[S.active.idx].timer;
      t.remaining = Math.max(0, t.endsAt - Date.now());
      t.running = false;
      save(); render();
    },
    'timer-done': () => {
      const s = S.active.steps[S.active.idx];
      if (s.unit === 'min') {
        const total = s.minutes * 60000;
        const left = s.timer ? (s.timer.running ? s.timer.endsAt - Date.now() : s.timer.remaining) : total;
        const mins = Math.round((total - Math.max(0, left)) / 60000);
        s.minutesDone = s.timer ? Math.max(1, mins) : s.minutes;
      }
      completeSet(null);
    },
    'rest-add': (el) => { S.active.restEndsAt += Number(el.dataset.d) * 1000; save(); tick(); },
    'rest-skip': () => { S.active.phase = 'exercise'; save(); render(); },
    skip: () => { const a = S.active; a.steps[a.idx].status = 'skipped'; a.steps[a.idx].timer = null; nextStep(false); },
    stop: () => openSheet(stopSheet()),
    'stop-skip': () => {
      const a = S.active, s = a.steps[a.idx];
      const zone = $sheet.querySelector('input[name=zone]:checked')?.value || '';
      s.status = 'stopped'; s.timer = null;
      a.pains.push({ ex: s.ex, zone });
      closeSheet(); nextStep(false);
    },
    'stop-end': () => {
      const a = S.active, s = a.steps[a.idx];
      const zone = $sheet.querySelector('input[name=zone]:checked')?.value || '';
      s.status = 'stopped'; s.timer = null;
      a.pains.push({ ex: s.ex, zone });
      a.phase = 'summary';
      closeSheet(); save(); render();
    },
    finish: () => { if (confirm('¿Terminar la sesión aquí? Se guardará lo que hayas hecho.')) { S.active.phase = 'summary'; save(); render(); } },
    'back-to-session': () => {
      const a = S.active;
      const i = a.steps.findIndex((s) => s.status === 'pending');
      if (i === -1) return toast('Ya no quedan ejercicios pendientes');
      a.idx = i; a.phase = 'exercise'; save(); render();
    },
    'step-list': () => openSheet(stepListSheet()),
    jump: (el) => {
      const a = S.active, i = Number(el.dataset.i), s = a.steps[i];
      if (s.status !== 'done') { s.status = 'pending'; s.timer = null; }
      a.idx = i; a.phase = 'exercise';
      closeSheet(); save(); render();
    },
    effort: (el) => {
      S.active.notes = document.getElementById('session-notes')?.value || '';
      S.active.effort = el.dataset.v; save(); render();
    },
    'save-session': saveSession,

    'media-pause': (el) => {
      const fig = el.closest('[data-media]');
      const v = fig.querySelector('video');
      const paused = fig.classList.toggle('paused');
      if (v) paused ? v.pause() : v.play();
      el.textContent = paused ? 'Seguir' : 'Pausa';
    },
    'media-zoom': (el) => {
      const fig = el.closest('[data-media]');
      const z = fig.classList.toggle('zoomed');
      el.textContent = z ? 'Cerrar' : 'Ampliar';
    },
    'del-user-video': async (el) => {
      if (!confirm('¿Quitar tu vídeo o foto de este ejercicio?')) return;
      await deleteUserVideo(el.dataset.ex);
      render(); toast('Vídeo quitado');
    },
    'save-media': (el) => {
      const v = document.getElementById('my-media').value.trim();
      if (v && !/^https?:\/\//i.test(v)) return toast('El enlace debe empezar por https://');
      if (v) S.userMedia[el.dataset.ex] = v; else delete S.userMedia[el.dataset.ex];
      save(); render(); toast(v ? 'Enlace guardado' : 'Enlace quitado');
    },

    week: (el) => { weekOffset += Number(el.dataset.d); render(); },
    day: (el) => openSheet(daySheet(el.dataset.k)),
    'set-day': (el) => { setPlan(el.dataset.k, el.dataset.id); save(); closeSheet(); render(); toast('Día actualizado'); },
    'reset-day': (el) => { delete S.overrides[el.dataset.k]; save(); closeSheet(); render(); },
    'move-day': (el) => {
      const a = el.dataset.k, b = el.dataset.to, pa = planFor(a), pb = planFor(b);
      setPlan(a, pb); setPlan(b, pa);
      save(); closeSheet(); render(); toast(`Movido al ${DOW[parse(b).getDay()].toLowerCase()}`);
    },
    'log-walk': (el) => openSheet(quickLogSheet('walk', el.dataset.k)),
    'log-skate': (el) => openSheet(quickLogSheet('skate', el.dataset.k)),
    'log-shoot': (el) => {
      S.logs.push({ id: uid(), type: 'shoot', date: el.dataset.k });
      save(); render(); toast('Hoy toca descansar. Bien.');
    },
    'save-quick': (el) => {
      const preset = $sheet.querySelector('input[name=mins]:checked')?.value;
      const custom = document.getElementById('mins-custom').value;
      const minutes = Number(custom || preset || 0);
      if (el.dataset.type === 'walk' && !minutes) return toast('Indica los minutos');
      S.logs.push({ id: uid(), type: el.dataset.type, date: el.dataset.k, minutes, notes: document.getElementById('quick-note').value.trim() });
      save(); closeSheet(); render(); toast('Registrado');
    },
    'del-log': (el) => {
      if (!confirm('¿Borrar este registro?')) return;
      S.logs = S.logs.filter((l) => l.id !== el.dataset.id); save(); render();
    },
    checkin: () => openSheet(checkinSheet()),
    'save-checkin': () => {
      const f = new FormData(document.getElementById('checkin-form'));
      const c = {};
      for (const [k, v] of f.entries()) if (String(v).trim()) c[k] = String(v).trim();
      S.checkins[todayKey()] = c;
      save(); closeSheet(); render(); toast('Guardado');
    },
    export: exportData,
    'reset-all': () => {
      if (!confirm('Esto borra todo tu historial de este móvil y no se puede deshacer. ¿Seguro?')) return;
      S = defaults(); save(); location.hash = '#/hoy'; render();
    },
  };

  async function exportData() {
    const json = JSON.stringify(S, null, 2);
    const name = `mixie-copia-${todayKey()}.json`;
    try {
      const file = new File([json], name, { type: 'application/json' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Copia de Mixie Training' });
        return;
      }
    } catch (e) { if (e.name === 'AbortError') return; }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    a.download = name;
    a.click();
  }
  async function importData(file) {
    try {
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data.logs) || typeof data.settings !== 'object') throw new Error('formato');
      if (!confirm('Esto sustituye los datos de este móvil por los de la copia. ¿Continuar?')) return;
      S = Object.assign(defaults(), data);
      S.settings = Object.assign(defaults().settings, data.settings);
      save(); render(); toast('Copia importada');
    } catch (e) { toast('Ese archivo no parece una copia de Mixie'); }
  }

  // Doble toque sobre una demostración con enlace: abre el vídeo original.
  let lastTap = { el: null, t: 0 };
  document.addEventListener('click', (ev) => {
    const stage = ev.target.closest('.media-stage');
    const fig = stage && stage.closest('[data-link]');
    if (!fig) return;
    const now = Date.now();
    if (lastTap.el === fig && now - lastTap.t < 400) {
      lastTap = { el: null, t: 0 };
      window.open(fig.dataset.link, '_blank', 'noopener');
    } else {
      lastTap = { el: fig, t: now };
    }
  });
  document.addEventListener('click', (ev) => {
    unlockAudio();
    const el = ev.target.closest('[data-action]');
    if (!el) return;
    const fn = actions[el.dataset.action];
    if (!fn) return;
    if (el.tagName === 'BUTTON' || el.dataset.action !== 'close-sheet-nav') ev.preventDefault();
    fn(el);
  });
  document.addEventListener('input', (ev) => {
    const el = ev.target;
    if (el.dataset.input === 'ex-search') {
      exQuery = el.value;
      const tmp = document.createElement('div');
      tmp.innerHTML = viewEjercicios();
      document.getElementById('ex-results').innerHTML = tmp.querySelector('#ex-results').innerHTML;
    }
  });
  document.addEventListener('change', (ev) => {
    const el = ev.target;
    if (el.dataset.input === 'import' && el.files[0]) return importData(el.files[0]);
    if (el.dataset.input === 'user-video' && el.files[0]) {
      const file = el.files[0];
      if (file.size > 150 * 1024 * 1024) return toast('Vídeo demasiado largo: recórtalo en Fotos');
      toast('Guardando…');
      saveUserVideo(el.dataset.ex, file).then(() => { render(); toast('Guardado en este móvil'); }).catch(() => toast('No se pudo guardar'));
      return;
    }
    const key = el.dataset.setting;
    if (!key) return;
    let v = el.type === 'checkbox' ? el.checked : el.value;
    if (el.type === 'number') v = Math.max(0, Number(v) || 0);
    if ((key === 'travelStart' || key === 'travelEnd') && !v) return;
    S.settings[key] = v;
    save(); toast('Guardado');
  });
  // Si una demostración no carga, se muestra la ilustración provisional.
  document.addEventListener('error', (ev) => {
    const img = ev.target;
    if (img.tagName !== 'IMG' || !img.hasAttribute('data-fallback')) return;
    const fig = img.closest('[data-media]');
    const holder = document.createElement('div');
    holder.innerHTML = placeholderHTML(!fig);
    (fig || img).replaceWith(holder.firstElementChild);
  }, true);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      if (route().name === 'sesion' && S.active && S.active.phase !== 'overview') keepAwake(true);
      if (route().name === 'hoy') render(); // por si ha cambiado el día
      tick();
    }
  });

  // ---------- rutas ----------
  function route() {
    const parts = (location.hash || '#/hoy').slice(2).split('/');
    return { name: parts[0] || 'hoy', arg: decodeURIComponent(parts[1] || '') };
  }
  const NAV = [['hoy', 'Hoy'], ['semana', 'Semana'], ['rutinas', 'Rutinas'], ['ejercicios', 'Ejercicios'], ['progreso', 'Progreso']];
  const NAV_OF = { rutina: 'rutinas', ejercicio: 'ejercicios', ajustes: 'progreso' };

  let lastRoute = '';
  function render() {
    const r = route();
    const views = {
      hoy: viewHoy, semana: viewSemana, rutinas: viewRutinas, rutina: () => viewRutina(r.arg),
      ejercicios: viewEjercicios, ejercicio: () => viewEjercicio(r.arg), progreso: viewProgreso,
      ajustes: viewAjustes, sesion: viewSesion,
    };
    const html = (views[r.name] || viewHoy)();
    if (location.hash === '#/hoy' && r.name === 'sesion') return;
    $main.innerHTML = html;
    document.body.classList.toggle('in-session', r.name === 'sesion');
    const cur = NAV_OF[r.name] || r.name;
    $nav.innerHTML = NAV.map(([id, label]) => `<a href="#/${id}" class="${cur === id ? 'on' : ''}" ${cur === id ? 'aria-current="page"' : ''}>${icon(id)}<span>${label}</span></a>`).join('');
    const key = location.hash + (r.name === 'sesion' && S.active ? `${S.active.phase}${S.active.idx}` : '');
    if (key !== lastRoute) { window.scrollTo(0, 0); lastRoute = key; }
  }
  window.addEventListener('hashchange', () => {
    closeSheet();
    if (route().name !== 'sesion') keepAwake(false);
    render();
  });
  if (!location.hash) location.hash = '#/hoy';
  render();
  loadUserVideos();
})();
