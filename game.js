/* Chilenodex — interfaz y bucle principal del juego. */
(function () {
  'use strict';
  var CX = window.CX;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var FONT_EMOJI = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';

  /* =============== Estado guardado =============== */
  var KEY = 'chilenodex.v1';
  function nuevoEstado() {
    return {
      v: 1, xp: 0, pinones: 5, fotos: 0, avist: 0, metros: 0, dex: {}, refugios: {},
      aj: { sonido: true, vibrar: true, zona: 'auto', habitat: 'auto', sim: false, simLat: -33.4489, simLon: -70.6693 }
    };
  }
  function cargar() {
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) {
        var o = JSON.parse(raw), n = nuevoEstado();
        var aj = Object.assign(n.aj, o.aj || {});
        return Object.assign(n, o, { aj: aj });
      }
    } catch (e) { /* almacenamiento no disponible */ }
    return nuevoEstado();
  }
  var S = cargar();
  var guardadoT = 0;
  function guardar() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* nada */ } }
  function guardarSuave() { var n = Date.now(); if (n - guardadoT > 8000) { guardadoT = n; guardar(); } }
  function nivel() { return CX.nivelPorXp(S.xp); }

  /* =============== Utilidades UI =============== */
  var toastT;
  function toast(msg, ms) {
    var t = $('#toast'); t.textContent = msg; t.classList.add('on');
    clearTimeout(toastT); toastT = setTimeout(function () { t.classList.remove('on'); }, ms || 2600);
  }

  var ac = null;
  function tono(notas, dur, tipo, vol) {
    if (!S.aj.sonido) return;
    try {
      ac = ac || new (window.AudioContext || window.webkitAudioContext)();
      if (ac.state === 'suspended') ac.resume();
      var t0 = ac.currentTime; dur = dur || 0.11;
      notas.forEach(function (f, i) {
        var o = ac.createOscillator(), g = ac.createGain(), t = t0 + i * dur;
        o.type = tipo || 'triangle'; o.frequency.value = f;
        g.gain.setValueAtTime(vol || 0.07, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur * 0.95);
        o.connect(g); g.connect(ac.destination); o.start(t); o.stop(t + dur);
      });
    } catch (e) { /* sin audio */ }
  }
  var SND = {
    ok: function () { tono([523, 659, 784]); },
    gran: function () { tono([523, 659, 784, 1047]); },
    nueva: function () { tono([523, 659, 784, 1047, 1319], 0.11); },
    mal: function () { tono([220, 165], 0.14, 'sawtooth', 0.045); },
    click: function () { tono([660], 0.06); }
  };
  function vibrar(p) { if (S.aj.vibrar && navigator.vibrate) { try { navigator.vibrate(p); } catch (e) { /* nada */ } } }

  function hexRgba(hex, a) {
    var h = hex.replace('#', '');
    return 'rgba(' + parseInt(h.substr(0, 2), 16) + ',' + parseInt(h.substr(2, 2), 16) + ',' + parseInt(h.substr(4, 2), 16) + ',' + a + ')';
  }

  function cerrarModal() { $('#modal').hidden = true; }
  function modal(html, botones) {
    botones = botones || [{ t: 'Cerrar', cls: 'btn-main' }];
    var card = $('#modalCard');
    card.innerHTML = html + '<div class="acciones"></div>';
    var cont = $('.acciones', card);
    botones.forEach(function (b) {
      var el = document.createElement('button');
      el.type = 'button'; el.className = b.cls || 'btn-sec'; el.textContent = b.t;
      el.onclick = function () { cerrarModal(); if (b.fn) b.fn(); };
      cont.appendChild(el);
    });
    card.scrollTop = 0;
    $('#modal').hidden = false;
  }

  /* =============== Jugador, mapa y mundo =============== */
  var J = { lat: S.aj.simLat, lon: S.aj.simLon, acc: null, alt: null, ts: 0, tieneFix: false, velMs: 0 };
  var modoSim = false, watchId = null, gpsError = 0, vehiculoHasta = 0;
  var zonaActual = CX.zonaPorCoord(J.lat, J.lon);
  var spawns = [], refugios = [], seq = 0, refugiosCentro = null;
  var habPerfil = null, habCentro = null, habCargando = false, habFallaHasta = 0;
  var habCache = {};
  var avisoSinMapa = false, avisoFuera = false;

  var mapa = new CX.MapView($('#mapa'), { lat: J.lat, lon: J.lon, z: 17.4 });
  window.addEventListener('resize', function () { mapa.resize(); });
  window.addEventListener('orientationchange', function () { setTimeout(function () { mapa.resize(); }, 250); });

  function zonaDe(lat, lon) { return S.aj.zona !== 'auto' && CX.ZONAS[S.aj.zona] ? S.aj.zona : CX.zonaPorCoord(lat, lon); }

  /* ---------- hábitat (OpenStreetMap / Overpass, opcional) ---------- */
  function perfilEfectivo() {
    var p = habPerfil ? Object.assign({}, habPerfil) : null;
    if (!modoSim && J.alt != null && J.alt > 2500) { p = p || {}; p.altoandino = (p.altoandino || 0) + 8; }
    return p;
  }

  function pedirPerfil(lat, lon, zona) {
    var key = Math.round(lat * 150) + '_' + Math.round(lon * 150);
    if (habCache[key]) return Promise.resolve(habCache[key]);
    if (Date.now() < habFallaHasta) return Promise.resolve(null);
    var dLat = 0.0075, dLon = 0.0075 / Math.cos(lat * Math.PI / 180);
    var bb = [lat - dLat, lon - dLon, lat + dLat, lon + dLon].map(function (v) { return v.toFixed(5); }).join(',');
    var q = '[out:json][timeout:8];(' +
      'way["natural"~"^(coastline|beach|bay|water|wetland|wood|scrub|grassland|heath|bare_rock|scree|fell)$"](' + bb + ');' +
      'way["waterway"~"^(river|stream|canal)$"](' + bb + ');' +
      'way["landuse"~"^(forest|meadow|grass|farmland)$"](' + bb + ');' +
      'way["leisure"="park"](' + bb + ');' +
      'node["natural"="peak"](' + bb + ');' +
      ');out tags 400;';
    var ctl = ('AbortController' in window) ? new AbortController() : null;
    var to = setTimeout(function () { if (ctl) ctl.abort(); }, 10000);
    return fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST', body: 'data=' + encodeURIComponent(q),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: ctl ? ctl.signal : undefined
    }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    }).then(function (js) {
      var cnt = CX.perfilDesdeOsm(js.elements, zona);
      habCache[key] = cnt;
      return cnt;
    }).catch(function () {
      habFallaHasta = Date.now() + 90000;
      return null;
    }).then(function (r) { clearTimeout(to); return r; });
  }

  function actualizarHabitat(forzar) {
    if (habCargando || S.aj.habitat !== 'auto') return;
    if (!forzar && habCentro && CX.metros(J.lat, J.lon, habCentro.lat, habCentro.lon) < 250) return;
    habCargando = true;
    var zona = zonaActual, primera = !habPerfil;
    pedirPerfil(J.lat, J.lon, zona).then(function (p) {
      habCargando = false;
      if (!p || zona !== zonaActual) return;
      habPerfil = p; habCentro = { lat: J.lat, lon: J.lon };
      if (primera) { spawns = []; mantenerSpawns(); }
      refrescarHud();
    });
  }

  /* ---------- apariciones ---------- */
  function crearSpawn(cerca) {
    var noche = CX.esDeNoche();
    var hab = S.aj.habitat !== 'auto' ? S.aj.habitat : CX.eligeHabitat(Math.random, perfilEfectivo(), zonaActual);
    var esp = CX.eligeEspecie(Math.random, zonaActual, hab, noche);
    if (!esp) return null;
    var d = cerca ? 15 + Math.random() * 15 : 30 + Math.sqrt(Math.random()) * 130;
    var p = CX.destino(J.lat, J.lon, Math.random() * Math.PI * 2, d);
    var min = esp.t === 'flora' ? 20 + Math.random() * 20 : 7 + Math.random() * 8;
    return { id: 's' + (++seq), esp: esp.id, lat: p.lat, lon: p.lon, hab: hab, exp: Date.now() + min * 60000, ph: Math.random() * 6.28 };
  }

  function mantenerSpawns() {
    var now = Date.now();
    spawns = spawns.filter(function (s) { return s.exp > now && CX.metros(J.lat, J.lon, s.lat, s.lon) < 350; });
    var guard = 0;
    while (spawns.length < 7 && guard++ < 20) {
      var hayCerca = spawns.some(function (s) { return CX.metros(J.lat, J.lon, s.lat, s.lon) < CX.RANGO_M * 0.85; });
      var s = crearSpawn(!hayCerca);
      if (s) spawns.push(s);
    }
  }

  function actualizarRefugios() {
    if (refugiosCentro && CX.metros(J.lat, J.lon, refugiosCentro.lat, refugiosCentro.lon) < 60) return;
    refugios = CX.refugiosCerca(J.lat, J.lon, 3);
    refugiosCentro = { lat: J.lat, lon: J.lon };
  }

  /* ---------- posición del jugador ---------- */
  function setJugador(lat, lon, acc, alt, ts, esSim) {
    var t = ts || Date.now();
    var primera = !J.tieneFix;
    if (J.tieneFix && !esSim) {
      var d = CX.metros(J.lat, J.lon, lat, lon), dt = (t - J.ts) / 1000;
      if (dt > 0 && (acc == null || acc < 60)) J.velMs = d / dt;
      if (d >= 3 && d < 200 && J.velMs < 7 && (acc == null || acc < 40)) S.metros += d;
      if (J.velMs >= 7 && d > 15) vehiculoHasta = Date.now() + 20000;
    }
    J.lat = lat; J.lon = lon; J.acc = acc; J.alt = alt; J.ts = t; J.tieneFix = true;
    if (primera) mapa.centrarEn(lat, lon);

    var zn = zonaDe(lat, lon);
    if (zn !== zonaActual) { zonaActual = zn; spawns = []; habPerfil = null; habCentro = null; }
    if (!avisoFuera && !esSim && S.aj.zona === 'auto' && CX.fueraDeChile(lat, lon)) {
      avisoFuera = true;
      toast('Parece que estás fuera de Chile: verás fauna y flora de la zona más cercana por latitud.', 5000);
    }
    actualizarRefugios();
    mantenerSpawns();
    actualizarHabitat(false);
    refrescarHud();
    guardarSuave();
  }

  function iniciarGPS() {
    detenerGPS();
    if (!navigator.geolocation) { toast('Este navegador no tiene GPS. Usa el modo simulación.', 4000); activarSim(true); return; }
    J.tieneFix = false; gpsError = 0;
    watchId = navigator.geolocation.watchPosition(function (pos) {
      if (modoSim) return;
      gpsError = 0;
      var c = pos.coords;
      setJugador(c.latitude, c.longitude, c.accuracy, c.altitude, pos.timestamp, false);
    }, function (err) {
      gpsError = err.code || 2;
      refrescarHud();
      if (err.code === 1) {
        modal('<div class="big">📍</div><h3>Necesitamos tu ubicación</h3>' +
          '<p>Para jugar con GPS, permite el acceso a la ubicación en el navegador (candado junto a la dirección). ' +
          'Mientras tanto puedes explorar en modo simulación.</p>',
          [{ t: 'Cerrar', cls: 'btn-sec' }, { t: '🧪 Modo simulación', cls: 'btn-main', fn: function () { activarSim(true); } }]);
      }
    }, { enableHighAccuracy: true, maximumAge: 3000, timeout: 30000 });
  }
  function detenerGPS() { if (watchId != null && navigator.geolocation) { navigator.geolocation.clearWatch(watchId); } watchId = null; }

  function activarSim(on) {
    modoSim = on; S.aj.sim = on; guardar();
    $('#dpad').hidden = !on; $('#chkSim').checked = on;
    if (on) {
      detenerGPS();
      J.tieneFix = false;
      setJugador(S.aj.simLat, S.aj.simLon, null, null, Date.now(), true);
      mapa.follow = true;
    } else {
      iniciarGPS();
    }
    refrescarHud();
  }

  function teletransportar(lat, lon) {
    S.aj.simLat = lat; S.aj.simLon = lon;
    spawns = []; habPerfil = null; habCentro = null; refugiosCentro = null;
    if (!modoSim) activarSim(true);
    else { J.tieneFix = false; setJugador(lat, lon, null, null, Date.now(), true); }
    mapa.centrarEn(lat, lon); mapa.follow = true;
    actualizarHabitat(true);
    guardar();
  }

  var PASO_M = 10, dirs = { n: 0, e: Math.PI / 2, s: Math.PI, o: 3 * Math.PI / 2 };
  function pasoSim(dir) {
    if (!modoSim || ocupado()) return;
    var p = CX.destino(J.lat, J.lon, dirs[dir], PASO_M);
    S.aj.simLat = p.lat; S.aj.simLon = p.lon;
    setJugador(p.lat, p.lon, null, null, Date.now(), true);
    mapa.follow = true;
  }

  function aplicarCambioMundo() {
    zonaActual = zonaDe(J.lat, J.lon);
    spawns = []; habPerfil = null; habCentro = null;
    mantenerSpawns(); actualizarHabitat(true); refrescarHud();
  }

  /* =============== HUD =============== */
  function ocupado() {
    return !$('#encuentro').hidden || !$('#modal').hidden || !$('#splash').hidden || panel !== 'mapa';
  }

  function refrescarHud() {
    var n = nivel(), base = CX.xpTotalNivel(n), sig = CX.xpTotalNivel(n + 1);
    $('#nivelNum').textContent = n;
    $('#xpFill').style.width = Math.max(0, Math.min(100, Math.round((S.xp - base) / (sig - base) * 100))) + '%';
    $('#xpTxt').textContent = (S.xp - base) + ' / ' + (sig - base) + ' XP';
    $('#pinonesN').textContent = S.pinones;
    var z = CX.ZONAS[zonaActual];
    $('#chipZona').textContent = '🧭 ' + z.nombre;
    var g = $('#chipGps');
    if (modoSim) g.textContent = '🧪 Simulación';
    else if (gpsError === 1) g.textContent = '⚠️ Sin permiso de GPS';
    else if (!J.tieneFix) g.textContent = '📡 Buscando GPS…';
    else g.textContent = '📡 ±' + Math.round(J.acc || 0) + ' m';
    $('#chipNoche').hidden = !CX.esDeNoche();
    var b = $('#banner');
    if (Date.now() < vehiculoHasta) { b.hidden = false; b.textContent = '🚗 Vas muy rápido: los encuentros están desactivados. ¡No juegues mientras conduces!'; }
    else b.hidden = true;
  }

  function ganarXp(n) {
    var antes = nivel();
    S.xp += n;
    var ahora = nivel();
    if (ahora > antes) { var extra = (ahora - antes) * 5; S.pinones += extra; return { subio: true, nivel: ahora, extra: extra }; }
    return { subio: false };
  }

  /* =============== Dibujo del mapa =============== */
  function burbuja(ctx, x, y, r, borde, fondo, emoji, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = 8; ctx.shadowOffsetY = 3;
    ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fillStyle = fondo; ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.lineWidth = 4; ctx.strokeStyle = borde; ctx.stroke();
    ctx.font = Math.round(r * 1.05) + 'px ' + FONT_EMOJI;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#000';
    ctx.fillText(emoji, x, y + r * 0.06);
    ctx.restore();
  }

  function dibuja(ts) {
    if (mapa.follow) { mapa.lat += (J.lat - mapa.lat) * 0.18; mapa.lon += (J.lon - mapa.lon) * 0.18; }
    mapa.dibujaBase();
    var ctx = mapa.ctx, mpp = mapa.metrosPorPixel(J.lat);
    var pj = mapa.aPantalla(J.lat, J.lon), now = Date.now();

    // zona de interacción
    var rr = CX.RANGO_M / mpp;
    ctx.beginPath(); ctx.arc(pj.x, pj.y, rr, 0, 7);
    ctx.fillStyle = 'rgba(74,194,139,.16)'; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(25,110,70,.8)'; ctx.setLineDash([6, 6]); ctx.stroke(); ctx.setLineDash([]);

    // precisión del GPS
    if (J.acc && J.acc > 20 && !modoSim) {
      ctx.beginPath(); ctx.arc(pj.x, pj.y, Math.min(140, J.acc / mpp), 0, 7);
      ctx.fillStyle = 'rgba(30,136,255,.08)'; ctx.fill();
    }

    // refugios
    refugios.forEach(function (r) {
      var p = mapa.aPantalla(r.lat, r.lon);
      if (p.x < -50 || p.y < -50 || p.x > mapa.W + 50 || p.y > mapa.H + 50) return;
      var recup = now - (S.refugios[r.id] || 0) < 600000;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.beginPath();
      for (var i = 0; i < 6; i++) {
        var a = Math.PI / 3 * i + Math.PI / 6;
        ctx.lineTo(Math.cos(a) * 24, Math.sin(a) * 24);
      }
      ctx.closePath();
      ctx.fillStyle = recup ? '#9aa8a2' : '#1d9e8b';
      ctx.shadowColor = 'rgba(0,0,0,.3)'; ctx.shadowBlur = 6; ctx.shadowOffsetY = 2;
      ctx.fill(); ctx.shadowColor = 'transparent';
      ctx.lineWidth = 3; ctx.strokeStyle = '#fff'; ctx.stroke();
      ctx.font = '22px ' + FONT_EMOJI; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#000';
      ctx.fillText(recup ? '⏳' : r.emoji, 0, 1);
      ctx.restore();
    });

    // especies
    spawns.forEach(function (s) {
      var p = mapa.aPantalla(s.lat, s.lon);
      if (p.x < -50 || p.y < -50 || p.x > mapa.W + 50 || p.y > mapa.H + 50) return;
      var esp = CX.byId[s.esp], rz = CX.RAREZAS[esp.r];
      var d = CX.metros(J.lat, J.lon, s.lat, s.lon), cerca = d <= CX.RANGO_M;
      var bob = Math.sin(ts / 500 + s.ph) * 3;
      var resta = s.exp - now;
      var alpha = resta < 30000 ? 0.55 + 0.45 * Math.sin(ts / 160) : 1;
      var r = cerca ? 28 : 25;
      if (cerca) {
        ctx.beginPath(); ctx.arc(p.x, p.y + bob, r + 7 + Math.sin(ts / 260) * 3, 0, 7);
        ctx.fillStyle = hexRgba(rz.color, 0.28); ctx.fill();
      }
      var visto = !!S.dex[esp.id];
      burbuja(ctx, p.x, p.y + bob, r, rz.color, visto ? '#ffffff' : '#e9eef0', esp.em, alpha);
      if (!visto) {
        ctx.save(); ctx.globalAlpha = 0.72; ctx.fillStyle = '#e9eef0';
        ctx.beginPath(); ctx.arc(p.x, p.y + bob, r - 2, 0, 7); ctx.fill();
        ctx.globalAlpha = alpha; ctx.font = 'bold ' + Math.round(r * 1.1) + 'px sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#51606a';
        ctx.fillText('?', p.x, p.y + bob + 1); ctx.restore();
      }
      // insignia fauna / flora
      ctx.save(); ctx.globalAlpha = alpha;
      ctx.beginPath(); ctx.arc(p.x + r * 0.78, p.y + bob - r * 0.78, 10, 0, 7);
      ctx.fillStyle = esp.t === 'flora' ? '#3a9d5d' : '#c97b3a'; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = '#fff'; ctx.stroke();
      ctx.font = '11px ' + FONT_EMOJI; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#000';
      ctx.fillText(esp.t === 'flora' ? '🌿' : '🐾', p.x + r * 0.78, p.y + bob - r * 0.78 + 1);
      ctx.restore();
    });

    // jugador
    var pulso = (Math.sin(ts / 450) + 1) / 2;
    ctx.beginPath(); ctx.arc(pj.x, pj.y, 18 + pulso * 8, 0, 7);
    ctx.fillStyle = 'rgba(30,136,255,' + (0.24 - pulso * 0.12) + ')'; ctx.fill();
    ctx.beginPath(); ctx.arc(pj.x, pj.y, 11, 0, 7);
    ctx.fillStyle = '#1e88ff'; ctx.fill(); ctx.lineWidth = 4; ctx.strokeStyle = '#fff'; ctx.stroke();

    if (!avisoSinMapa && mapa.tilesOk === 0 && mapa.tilesFail >= 6) {
      avisoSinMapa = true;
      toast('No se pudo cargar el mapa (¿sin conexión?). El juego sigue funcionando.', 5000);
    }
  }

  var ultimoFrame = 0;
  function frame(ts) {
    requestAnimationFrame(frame);
    if (ts - ultimoFrame < 28) return;
    ultimoFrame = ts;
    dibuja(ts);
  }

  /* =============== Toques en el mapa =============== */
  mapa.onUserPan = function () { /* el botón 📍 vuelve a centrar */ };

  mapa.onTap = function (x, y) {
    if (ocupado()) return;
    var mejor = null, md = 1e9;
    spawns.forEach(function (s) {
      var p = mapa.aPantalla(s.lat, s.lon), d = Math.hypot(p.x - x, p.y - y);
      if (d < 36 && d < md) { md = d; mejor = { tipo: 's', o: s }; }
    });
    refugios.forEach(function (r) {
      var p = mapa.aPantalla(r.lat, r.lon), d = Math.hypot(p.x - x, p.y - y);
      if (d < 34 && d < md) { md = d; mejor = { tipo: 'r', o: r }; }
    });
    if (!mejor) return;
    if (Date.now() < vehiculoHasta) { toast('Vas muy rápido. ¡No juegues mientras conduces!'); return; }
    var dist = CX.metros(J.lat, J.lon, mejor.o.lat, mejor.o.lon);
    if (dist > CX.RANGO_M) {
      toast('Está a ' + Math.round(dist) + ' m. Acércate a menos de ' + CX.RANGO_M + ' m para interactuar.');
      return;
    }
    if (mejor.tipo === 's') abrirEncuentro(mejor.o); else visitarRefugio(mejor.o);
  };

  function visitarRefugio(r) {
    var ahora = Date.now(), ult = S.refugios[r.id] || 0, COOL = 10 * 60000;
    if (ahora - ult < COOL) {
      toast(r.nombre + ' se está recuperando: vuelve en ' + Math.ceil((COOL - (ahora - ult)) / 60000) + ' min.');
      return;
    }
    S.refugios[r.id] = ahora;
    var pin = 2 + Math.floor(Math.random() * 4);
    S.pinones += pin;
    var lv = ganarXp(25);
    var esp = CX.ESPECIES[Math.floor(Math.random() * CX.ESPECIES.length)];
    guardar(); refrescarHud(); SND.gran(); vibrar(40);
    modal('<div class="big">' + r.emoji + '</div><h3>' + r.nombre + '</h3>' +
      '<p class="centro">Encontraste <b>' + pin + ' 🌰</b> y ganaste <b>25 XP</b>.</p>' +
      (lv.subio ? '<p class="centro">🎉 ¡Subiste al nivel <b>' + lv.nivel + '</b>! +' + lv.extra + ' 🌰</p>' : '') +
      '<p><b>¿Sabías que…?</b><br>' + esp.em + ' <b>' + esp.n + '</b>: ' + esp.d + '</p>',
      [{ t: 'Seguir explorando', cls: 'btn-main' }]);
  }

  /* =============== Encuentro (foto / registro) =============== */
  var R0 = 150, RMIN = 18, TARGET = 56;
  var Enc = { on: false, esp: null, spawn: null, intentos: 3, pinon: false, r: R0, estado: 'jugando', raf: 0, last: 0,
              flash: 0, flashCol: '#ffffff', ctx: null, msgT: 0 };

  function setMsg(txt, col) {
    var m = $('#encMsg'); m.textContent = txt; m.style.color = col || '#fff';
    clearTimeout(Enc.msgT); if (txt) Enc.msgT = setTimeout(function () { m.textContent = ''; }, 1500);
  }

  function actualizaEncUI() {
    var pin = '';
    for (var i = 0; i < 3; i++) pin += i < Enc.intentos ? '● ' : '○ ';
    $('#encIntentos').textContent = (Enc.esp && Enc.esp.t === 'flora' ? '📓 ' : '📷 ') + pin;
    var b = $('#btnPinon');
    b.disabled = Enc.pinon || S.pinones < 1 || Enc.estado !== 'jugando';
    $('#nPinon').textContent = Enc.pinon ? '(activo)' : '(' + S.pinones + ')';
  }

  function prepararCanvasEnc() {
    var cv = $('#encCanvas'), dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    var sz = Math.max(200, Math.round(cv.getBoundingClientRect().width));
    cv.width = Math.round(sz * dpr); cv.height = Math.round(sz * dpr);
    var c = cv.getContext('2d');
    c.setTransform(dpr * sz / 320, 0, 0, dpr * sz / 320, 0, 0);
    Enc.ctx = c;
  }

  function abrirEncuentro(sp) {
    var esp = CX.byId[sp.esp], hab = CX.HABITATS[sp.hab] || {}, rz = CX.RAREZAS[esp.r];
    Enc.esp = esp; Enc.spawn = sp; Enc.intentos = 3; Enc.pinon = false; Enc.r = R0;
    Enc.estado = 'jugando'; Enc.flash = 0; Enc.flashCol = '#ffffff';
    $('#encuentro').style.setProperty('--hab', hab.color || '#2f7d4f');
    $('#encNombre').textContent = esp.n;
    $('#encSci').textContent = esp.c;
    var chip = $('#encRareza'); chip.textContent = rz.nombre; chip.style.borderColor = rz.color; chip.style.color = rz.color;
    $('#encHab').textContent = (hab.emoji || '') + ' ' + (hab.nombre || '');
    $('#btnDisparo').textContent = esp.t === 'flora' ? '📓 Registrar' : '📸 Fotografiar';
    $('#encResultado').hidden = true; $('#encMsg').textContent = '';
    actualizaEncUI();
    $('#encuentro').hidden = false;
    prepararCanvasEnc();
    Enc.on = true; Enc.last = performance.now();
    cancelAnimationFrame(Enc.raf); Enc.raf = requestAnimationFrame(frameEnc);
    SND.click();
  }

  function cerrarEncuentro() {
    Enc.on = false; cancelAnimationFrame(Enc.raf);
    $('#encuentro').hidden = true; $('#encResultado').hidden = true;
    refrescarHud();
  }

  function frameEnc(ts) {
    if (!Enc.on) return;
    Enc.raf = requestAnimationFrame(frameEnc);
    var dt = Math.min(0.05, (ts - Enc.last) / 1000); Enc.last = ts;
    if (Enc.estado === 'jugando') {
      var rz = CX.RAREZAS[Enc.esp.r];
      Enc.r -= rz.vel * (Enc.pinon ? 0.85 : 1) * dt;
      if (Enc.r < RMIN) Enc.r = R0;
    }
    if (Enc.flash > 0) Enc.flash = Math.max(0, Enc.flash - dt * 2.2);
    dibujaEnc(ts);
  }

  function dibujaEnc(ts) {
    var c = Enc.ctx; if (!c) return;
    var esp = Enc.esp, rz = CX.RAREZAS[esp.r];
    c.clearRect(0, 0, 320, 320);

    var g = c.createRadialGradient(160, 160, 20, 160, 160, 150);
    g.addColorStop(0, hexRgba(rz.color, 0.4)); g.addColorStop(1, hexRgba(rz.color, 0));
    c.fillStyle = g; c.beginPath(); c.arc(160, 160, 150, 0, 7); c.fill();

    // marco de visor
    c.strokeStyle = 'rgba(255,255,255,.75)'; c.lineWidth = 3; c.lineCap = 'round';
    var m = 14, L = 26;
    [[m, m, 1, 1], [320 - m, m, -1, 1], [m, 320 - m, 1, -1], [320 - m, 320 - m, -1, -1]].forEach(function (k) {
      c.beginPath(); c.moveTo(k[0], k[1] + k[3] * L); c.lineTo(k[0], k[1]); c.lineTo(k[0] + k[2] * L, k[1]); c.stroke();
    });

    // especie
    c.save();
    var bob = Math.sin(ts / 420) * 5, dx = esp.t === 'fauna' ? Math.sin(ts / 950) * 7 : 0;
    c.translate(160 + dx, 160 + bob);
    if (esp.t === 'flora') c.rotate(Math.sin(ts / 800) * 0.05);
    c.font = '108px ' + FONT_EMOJI; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = '#000';
    c.fillText(esp.em, 0, 6);
    c.restore();

    // anillo objetivo
    c.setLineDash([7, 7]); c.lineWidth = 3; c.strokeStyle = 'rgba(255,255,255,.92)';
    c.beginPath(); c.arc(160, 160, TARGET, 0, 7); c.stroke(); c.setLineDash([]);

    // anillo que se achica
    var tol = rz.tol * (Enc.pinon ? 1.35 : 1), delta = Math.abs(Enc.r - TARGET);
    var col = delta <= tol ? '#ffd54a' : delta <= tol * 2.4 ? '#69e08f' : delta <= tol * 4.2 ? '#ffa04a' : '#8fd3ff';
    c.lineWidth = 6; c.strokeStyle = col;
    c.beginPath(); c.arc(160, 160, Enc.r, 0, 7); c.stroke();

    if (Enc.flash > 0) { c.fillStyle = hexRgba(Enc.flashCol, Enc.flash * 0.5); c.fillRect(0, 0, 320, 320); }
  }

  function disparo() {
    if (!Enc.on || Enc.estado !== 'jugando') return;
    var rz = CX.RAREZAS[Enc.esp.r];
    var tol = rz.tol * (Enc.pinon ? 1.35 : 1);
    var q = CX.calidad(Math.abs(Enc.r - TARGET), tol);
    Enc.flash = 1;
    if (q > 0) { Enc.flashCol = '#ffffff'; capturar(q); return; }

    Enc.flashCol = '#ff5b3a'; Enc.intentos--; SND.mal(); vibrar(60);
    var esFauna = Enc.esp.t === 'fauna';
    if (esFauna && Math.random() < rz.huida * (Enc.pinon ? 0.5 : 1)) { finEncuentro('huyo'); return; }
    if (Enc.intentos <= 0) { finEncuentro(esFauna ? 'huyo' : 'agotado'); return; }
    setMsg(esFauna ? '¡Se movió! Foto borrosa' : 'Registro incompleto', '#ffb29e');
    actualizaEncUI();
    Enc.r = R0;
  }

  function usarPinon() {
    if (!Enc.on || Enc.pinon || S.pinones < 1 || Enc.estado !== 'jugando') return;
    S.pinones--; Enc.pinon = true; guardar(); refrescarHud(); actualizaEncUI(); SND.click();
    setMsg('🌰 ¡Piñón! Todo se vuelve más fácil', '#ffe59a');
  }

  function capturar(q) {
    Enc.estado = 'resultado';
    var esp = Enc.esp, reg = S.dex[esp.id], nueva = !reg;
    var xp = CX.xpPorFoto(esp, q, nueva);
    S.dex[esp.id] = { n: (reg ? reg.n : 0) + 1, mejor: Math.max(reg ? reg.mejor : 0, q), primera: reg ? reg.primera : Date.now() };
    S.fotos++; S.avist++;
    var lv = ganarXp(xp);
    spawns = spawns.filter(function (s) { return s.id !== Enc.spawn.id; });
    guardar(); refrescarHud(); actualizaEncUI();
    if (nueva) SND.nueva(); else if (q === 3) SND.gran(); else SND.ok();
    vibrar(nueva ? [40, 60, 40] : 30);
    mostrarResultado({ esp: esp, q: q, xp: xp, nueva: nueva, lv: lv });
    mantenerSpawns();
  }

  function etiquetas(esp) {
    var rz = CX.RAREZAS[esp.r], est = esp.e ? CX.ESTADOS[esp.e] : null, h = '<div class="tags">';
    if (est) h += '<span class="estado" style="background:' + est.color + '">' + est.nombre + '</span>';
    h += '<span class="tag" style="border-color:' + rz.color + ';color:' + rz.color + '">' + rz.nombre + '</span></div>';
    return h;
  }

  function mostrarResultado(r) {
    var cal = ['', 'Regular', '¡Bien!', '¡Excelente!'][r.q];
    var verbo = r.esp.t === 'flora' ? 'Registro' : 'Foto';
    var box = $('#encResultado');
    box.innerHTML = '<div class="modal-card">' +
      (r.nueva ? '<span class="nueva">¡NUEVA ESPECIE!</span>' : '') +
      '<div class="big">' + r.esp.em + '</div><h3>' + r.esp.n + '</h3><div class="sci">' + r.esp.c + '</div>' +
      '<div class="estrellas">' + '★'.repeat(r.q) + '☆'.repeat(3 - r.q) + '</div>' +
      '<div class="centro"><b>' + verbo + ': ' + cal + '</b></div>' +
      '<div class="xp-ganada">+' + r.xp + ' XP</div>' +
      (r.lv.subio ? '<p class="centro">🎉 ¡Subiste al nivel <b>' + r.lv.nivel + '</b>! +' + r.lv.extra + ' 🌰</p>' : '') +
      etiquetas(r.esp) + '<p>' + r.esp.d + '</p>' +
      '<div class="acciones"><button type="button" class="btn-sec" id="resFicha">📖 Ficha</button>' +
      '<button type="button" class="btn-main" id="resOk">Continuar</button></div></div>';
    box.hidden = false;
    $('#resOk').onclick = cerrarEncuentro;
    $('#resFicha').onclick = function () { cerrarEncuentro(); abrirFicha(r.esp); };
  }

  function finEncuentro(motivo) {
    Enc.estado = 'fin'; actualizaEncUI();
    var esp = Enc.esp;
    if (motivo === 'huyo') { spawns = spawns.filter(function (s) { return s.id !== Enc.spawn.id; }); mantenerSpawns(); }
    var box = $('#encResultado');
    box.innerHTML = '<div class="modal-card"><div class="big" style="opacity:.8">' + (motivo === 'huyo' ? '💨' : '📓') + '</div>' +
      '<h3>' + (motivo === 'huyo' ? esp.n + ' se alejó' : 'Se acabaron los intentos') + '</h3>' +
      '<p class="centro">' + (motivo === 'huyo'
        ? 'Los animales se asustan con facilidad. La próxima vez usa un piñón y toca justo cuando el anillo calce.'
        : 'La planta sigue ahí: puedes volver a intentarlo cuando quieras.') + '</p>' +
      '<div class="acciones"><button type="button" class="btn-main" id="resOk">Volver al mapa</button></div></div>';
    box.hidden = false;
    $('#resOk').onclick = cerrarEncuentro;
  }

  /* =============== Chilenodex, mochila y ajustes =============== */
  var panel = 'mapa', dexFiltro = 'todo';

  function irPanel(p) {
    panel = p;
    $$('.panel').forEach(function (el) { el.hidden = el.id !== 'p-' + p; });
    $$('#nav button').forEach(function (b) { b.classList.toggle('on', b.dataset.p === p); });
    if (p === 'dex') renderDex();
    if (p === 'mochila') renderMochila();
    if (p === 'ajustes') renderAjustes();
  }

  function renderDex() {
    var lista = CX.ESPECIES.filter(function (e) { return dexFiltro === 'todo' || e.t === dexFiltro; });
    $('#dexProgreso').textContent = Object.keys(S.dex).length + ' / ' + CX.ESPECIES.length + ' especies';
    var grid = $('#dexGrid'); grid.innerHTML = '';
    lista.forEach(function (e) {
      var reg = S.dex[e.id], rz = CX.RAREZAS[e.r];
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'dex-card' + (reg ? '' : ' no');
      if (reg) b.style.setProperty('--rc', rz.color);
      b.innerHTML = '<span class="num">#' + String(e.num).padStart(3, '0') + '</span>' +
        '<span class="em">' + e.em + '</span>' +
        '<span class="nm">' + (reg ? e.n : '???') + '</span>' +
        '<span class="stars">' + (reg ? '★'.repeat(reg.mejor) + '☆'.repeat(3 - reg.mejor) : '') + '</span>';
      b.onclick = function () { abrirFicha(e); };
      grid.appendChild(b);
    });
  }

  function abrirFicha(e) {
    var reg = S.dex[e.id], rz = CX.RAREZAS[e.r];
    var zonas = e.z.map(function (z) { return '<span class="tag">' + CX.ZONAS[z].nombre + '</span>'; }).join('');
    var habs = e.h.map(function (h) { return '<span class="tag">' + CX.HABITATS[h].emoji + ' ' + CX.HABITATS[h].nombre + '</span>'; }).join('');
    var num = '#' + String(e.num).padStart(3, '0');
    if (!reg) {
      modal('<div class="big" style="filter:grayscale(1) brightness(.3)">' + e.em + '</div>' +
        '<h3>' + num + ' · Sin registrar</h3><div class="sci">' + (e.t === 'flora' ? 'Flora' : 'Fauna') + ' · ' + rz.nombre + '</div>' +
        '<p class="centro"><b>Pista:</b> búscala en…</p><div class="tags">' + zonas + '</div><div class="tags">' + habs + '</div>' +
        (e.noche ? '<p class="centro">🌙 Solo sale de noche.</p>' : '') +
        (e.marino ? '<p class="centro">🌊 Aparece cerca del mar.</p>' : ''));
      return;
    }
    modal('<div class="big">' + e.em + '</div><h3>' + e.n + '</h3><div class="sci">' + e.c + ' · ' + num + '</div>' +
      etiquetas(e) +
      '<div class="estrellas">' + '★'.repeat(reg.mejor) + '☆'.repeat(3 - reg.mejor) + '</div>' +
      '<p class="centro muted">Registrada ' + reg.n + (reg.n === 1 ? ' vez' : ' veces') + '</p>' +
      '<p>' + e.d + '</p><div class="tags">' + zonas + '</div><div class="tags">' + habs + '</div>' +
      (e.noche ? '<p class="centro">🌙 Solo sale de noche.</p>' : ''));
  }

  function renderMochila() {
    var fauna = CX.ESPECIES.filter(function (e) { return e.t === 'fauna'; });
    var flora = CX.ESPECIES.filter(function (e) { return e.t === 'flora'; });
    function vistas(l) { return l.filter(function (e) { return S.dex[e.id]; }).length; }
    var items = [
      [nivel(), 'Nivel'], [S.xp, 'XP total'],
      [vistas(fauna) + ' / ' + fauna.length, 'Fauna 🦊'], [vistas(flora) + ' / ' + flora.length, 'Flora 🌿'],
      [S.avist, 'Avistamientos'], [(S.metros / 1000).toFixed(2) + ' km', 'Caminados'],
      [S.pinones, 'Piñones 🌰'], [Object.keys(S.refugios).length, 'Refugios visitados']
    ];
    $('#statsGrid').innerHTML = items.map(function (it) { return '<div class="stat"><b>' + it[0] + '</b><span>' + it[1] + '</span></div>'; }).join('');
    $('#zonaProgreso').innerHTML = Object.keys(CX.ZONAS).map(function (k) {
      var l = CX.ESPECIES.filter(function (e) { return e.z.indexOf(k) >= 0; });
      var v = vistas(l), z = CX.ZONAS[k];
      return '<div class="zp"><div class="l"><span>' + z.nombre + ' <span class="muted">· ' + z.desc + '</span></span><b>' + v + '/' + l.length + '</b></div>' +
        '<div class="b"><i style="width:' + Math.round(v / l.length * 100) + '%;--zc:' + z.color + '"></i></div></div>';
    }).join('');
  }

  var LUGARES = [
    ['Arica', -18.4783, -70.3126], ['San Pedro de Atacama', -22.9087, -68.1997], ['Copiapó', -27.3668, -70.3314],
    ['La Serena', -29.9027, -71.2519], ['Santiago', -33.4489, -70.6693], ['Concepción', -36.8201, -73.0444],
    ['Pucón', -39.2823, -71.9548], ['Valdivia', -39.8142, -73.2459], ['Castro (Chiloé)', -42.4725, -73.7646],
    ['Coyhaique', -45.5712, -72.0685], ['Puerto Natales', -51.7236, -72.4979],
    ['Hanga Roa (Rapa Nui)', -27.1127, -109.3497], ['San Juan Bautista (Juan Fernández)', -33.6397, -78.8344]
  ];

  function poblarSelects() {
    var z = $('#selZona'); z.innerHTML = '<option value="auto">Automática (según tu ubicación)</option>' +
      Object.keys(CX.ZONAS).map(function (k) { return '<option value="' + k + '">' + CX.ZONAS[k].nombre + ' — ' + CX.ZONAS[k].desc + '</option>'; }).join('');
    var h = $('#selHabitat'); h.innerHTML = '<option value="auto">Automático (OpenStreetMap)</option>' +
      Object.keys(CX.HABITATS).map(function (k) { return '<option value="' + k + '">' + CX.HABITATS[k].emoji + ' ' + CX.HABITATS[k].nombre + '</option>'; }).join('');
    $('#selTele').innerHTML = LUGARES.map(function (l, i) { return '<option value="' + i + '">' + l[0] + '</option>'; }).join('');
  }

  function renderAjustes() {
    $('#chkSonido').checked = !!S.aj.sonido; $('#chkVibrar').checked = !!S.aj.vibrar;
    $('#chkSim').checked = modoSim; $('#selZona').value = S.aj.zona; $('#selHabitat').value = S.aj.habitat;
  }

  /* =============== Eventos =============== */
  $$('#nav button').forEach(function (b) { b.onclick = function () { irPanel(b.dataset.p); }; });
  $$('#dexTabs button').forEach(function (b) {
    b.onclick = function () {
      dexFiltro = b.dataset.f;
      $$('#dexTabs button').forEach(function (x) { x.classList.toggle('on', x === b); });
      renderDex();
    };
  });
  $('#modal').addEventListener('click', function (e) { if (e.target === $('#modal')) cerrarModal(); });

  $('#btnCentrar').onclick = function () { mapa.follow = true; mapa.centrarEn(J.lat, J.lon); };
  $('#btnZoomMas').onclick = function () { mapa.setZoom(mapa.z + 0.5); };
  $('#btnZoomMenos').onclick = function () { mapa.setZoom(mapa.z - 0.5); };

  $('#btnDisparo').onclick = disparo;
  $('#btnPinon').onclick = usarPinon;
  $('#encSalir').onclick = cerrarEncuentro;
  $('#encCanvas').addEventListener('pointerdown', function (e) { e.preventDefault(); disparo(); });

  $('#chkSonido').onchange = function (e) { S.aj.sonido = e.target.checked; guardar(); };
  $('#chkVibrar').onchange = function (e) { S.aj.vibrar = e.target.checked; guardar(); };
  $('#chkSim').onchange = function (e) { activarSim(e.target.checked); };
  $('#btnTele').onclick = function () {
    var l = LUGARES[+$('#selTele').value];
    teletransportar(l[1], l[2]); irPanel('mapa');
    toast('📍 ' + l[0] + ' · ' + CX.ZONAS[zonaActual].nombre, 3500);
  };
  $('#selZona').onchange = function (e) { S.aj.zona = e.target.value; guardar(); aplicarCambioMundo(); };
  $('#selHabitat').onchange = function (e) { S.aj.habitat = e.target.value; guardar(); aplicarCambioMundo(); };
  $('#btnReset').onclick = function () {
    modal('<div class="big">🗑️</div><h3>¿Borrar tu progreso?</h3><p class="centro">Se perderán tu Chilenodex, nivel y piñones. No se puede deshacer.</p>',
      [{ t: 'Cancelar', cls: 'btn-sec' }, {
        t: 'Borrar todo', cls: 'btn-peligro', fn: function () { try { localStorage.removeItem(KEY); } catch (e) { /* nada */ } location.reload(); }
      }]);
  };

  $$('#dpad button').forEach(function (b) {
    var iv = null;
    function parar() { clearInterval(iv); iv = null; }
    b.addEventListener('pointerdown', function (e) {
      e.preventDefault(); parar(); pasoSim(b.dataset.d);
      iv = setInterval(function () { pasoSim(b.dataset.d); }, 120);
    });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(function (ev) { b.addEventListener(ev, parar); });
  });
  document.addEventListener('keydown', function (e) {
    var m = { ArrowUp: 'n', ArrowDown: 's', ArrowLeft: 'o', ArrowRight: 'e', w: 'n', s: 's', a: 'o', d: 'e' }[e.key];
    if (m && modoSim && !ocupado()) { e.preventDefault(); pasoSim(m); }
  });

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) { mapa.resize(); mantenerSpawns(); refrescarHud(); }
    else guardar();
  });
  window.addEventListener('pagehide', guardar);

  /* =============== Inicio =============== */
  function empezar(sim) {
    $('#splash').hidden = true;
    mapa.resize();
    if (sim) activarSim(true); else { modoSim = false; S.aj.sim = false; $('#dpad').hidden = true; iniciarGPS(); }
    setTimeout(function () { toast('Acércate a una especie dentro del círculo punteado y tócala 👆', 5000); }, 1200);
  }
  $('#btnJugar').onclick = function () { empezar(false); };
  $('#btnJugarSim').onclick = function () { empezar(true); };

  poblarSelects();
  actualizarRefugios();
  refrescarHud();
  requestAnimationFrame(frame);
  setInterval(function () {
    if (!$('#splash').hidden) return;
    mantenerSpawns(); actualizarHabitat(false); refrescarHud(); guardarSuave();
  }, 15000);

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(function () { /* sin modo offline */ });
  }

  // Para pruebas automáticas
  window.__CX = {
    estado: function () { return S; }, spawns: function () { return spawns; }, jugador: function () { return J; },
    zona: function () { return zonaActual; }, abrirEncuentro: abrirEncuentro, mapa: mapa, teletransportar: teletransportar,
    enc: Enc, refugios: function () { return refugios; }
  };
})();
