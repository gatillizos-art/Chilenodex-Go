/* Chilenodex — lógica pura del juego (sin DOM): geografía, apariciones, puntaje. */
(function (root) {
  'use strict';
  var CX = root.CX = root.CX || {};

  CX.RANGO_M = 40;          // distancia máxima para interactuar
  CX.CELDA = 0.004;         // tamaño de celda (grados) para los refugios

  /* ---------- aleatoriedad determinista ---------- */
  CX.hash = function (str) {
    var h = 1779033703 ^ str.length;
    for (var i = 0; i < str.length; i++) {
      h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };

  CX.rng = function (seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  /* ---------- geografía ---------- */
  CX.metros = function (lat1, lon1, lat2, lon2) {
    var R = 6371000, k = Math.PI / 180;
    var dLat = (lat2 - lat1) * k, dLon = (lon2 - lon1) * k;
    var x = Math.pow(Math.sin(dLat / 2), 2) +
            Math.cos(lat1 * k) * Math.cos(lat2 * k) * Math.pow(Math.sin(dLon / 2), 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)));
  };

  // rumbo en radianes (0 = norte, π/2 = este)
  CX.destino = function (lat, lon, rumbo, dist) {
    var R = 6371000, k = Math.PI / 180, dr = dist / R;
    var la = lat * k, lo = lon * k;
    var la2 = Math.asin(Math.sin(la) * Math.cos(dr) + Math.cos(la) * Math.sin(dr) * Math.cos(rumbo));
    var lo2 = lo + Math.atan2(Math.sin(rumbo) * Math.sin(dr) * Math.cos(la),
                              Math.cos(dr) - Math.sin(la) * Math.sin(la2));
    return { lat: la2 / k, lon: ((lo2 / k + 540) % 360) - 180 };
  };

  CX.zonaPorCoord = function (lat, lon) {
    if (Math.abs(lat + 27.12) < 1.2 && Math.abs(lon + 109.4) < 1.2) return 'rapanui';
    if (Math.abs(lat + 33.7) < 1.2 && Math.abs(lon + 79.8) < 1.8) return 'juanfernandez';
    if (lat > -26) return 'norte';
    if (lat > -32.5) return 'nortechico';
    if (lat > -37) return 'centro';
    if (lat > -43.5) return 'sur';
    return 'austral';
  };

  CX.fueraDeChile = function (lat, lon) {
    var z = CX.zonaPorCoord(lat, lon);
    if (z === 'rapanui' || z === 'juanfernandez') return false;
    return lon > -66 || lon < -76.5 || lat > -17 || lat < -56.5;
  };

  CX.esDeNoche = function (fecha) {
    var d = fecha || new Date();
    var h = d.getHours() + d.getMinutes() / 60;
    return h >= 20.5 || h < 6.5;
  };

  /* ---------- hábitat y especies ---------- */
  // perfil: { habitat: peso } obtenido de OpenStreetMap (puede ser null)
  CX.eligeHabitat = function (rand, perfil, zona) {
    var base = {}, k, tot = 0;
    CX.ZONAS[zona].habitats.forEach(function (h) { base[h] = (base[h] || 0) + 3; });
    if (perfil) for (k in perfil) if (perfil[k] > 0) base[k] = (base[k] || 0) + perfil[k];
    for (k in base) tot += base[k];
    var x = rand() * tot;
    for (k in base) { x -= base[k]; if (x <= 0) return k; }
    return Object.keys(base)[0];
  };

  CX.candidatas = function (zona, habitat, noche, estricto) {
    return CX.ESPECIES.filter(function (e) {
      if (e.z.indexOf(zona) < 0) return false;
      if (e.noche && !noche) return false;
      // en las islas el mar está siempre cerca: las especies marinas pueden aparecer en cualquier hábitat
      if (e.marino && habitat !== 'costa' && !CX.ZONAS[zona].isla) return false;
      if (estricto && e.h.indexOf(habitat) < 0 && !(e.marino && CX.ZONAS[zona].isla)) return false;
      return true;
    });
  };

  CX.eligeEspecie = function (rand, zona, habitat, noche) {
    var estr = CX.candidatas(zona, habitat, noche, true);
    // si el hábitat tiene pocas especies, se mezclan las de la zona (con menos peso)
    var lista = estr.length < 4 ? CX.candidatas(zona, habitat, noche, false) : estr;
    if (!lista.length) return null;
    var tot = 0, pesos = lista.map(function (e) {
      var w = CX.RAREZAS[e.r].peso;
      if (e.noche) w *= 2;
      if (estr.indexOf(e) < 0) w *= 0.25;
      tot += w;
      return w;
    });
    var x = rand() * tot;
    for (var i = 0; i < lista.length; i++) { x -= pesos[i]; if (x <= 0) return lista[i]; }
    return lista[lista.length - 1];
  };

  // Convierte elementos de Overpass (con tags) en pesos por hábitat (0–10 cada uno).
  CX.perfilDesdeOsm = function (elementos, zona) {
    var cnt = { bosque: 0, humedal: 0, costa: 0, matorral: 0, altoandino: 0, desierto: 0, estepa: 0 };
    (elementos || []).forEach(function (el) {
      var t = el.tags || {};
      if (t.natural === 'coastline' || t.natural === 'beach' || t.natural === 'bay') cnt.costa += 3;
      else if (t.natural === 'water' || t.natural === 'wetland' || t.waterway) cnt.humedal += 1;
      else if (t.natural === 'wood' || t.landuse === 'forest') cnt.bosque += 1;
      else if (t.natural === 'bare_rock' || t.natural === 'scree' || t.natural === 'fell' || t.natural === 'peak') cnt.altoandino += 1;
      else if (t.natural === 'grassland' && zona === 'austral') cnt.estepa += 1;
      else if (t.natural === 'scrub' || t.natural === 'heath' || t.natural === 'grassland' ||
               t.landuse === 'meadow' || t.landuse === 'grass' || t.landuse === 'farmland' || t.leisure === 'park') cnt.matorral += 1;
    });
    for (var k in cnt) cnt[k] = Math.min(cnt[k], 10);
    return cnt;
  };

  /* ---------- refugios (puntos de interés) ---------- */
  CX.refugiosCerca = function (lat, lon, radioCeldas) {
    var i0 = Math.floor(lat / CX.CELDA), j0 = Math.floor(lon / CX.CELDA), out = [];
    for (var i = i0 - radioCeldas; i <= i0 + radioCeldas; i++) {
      for (var j = j0 - radioCeldas; j <= j0 + radioCeldas; j++) {
        var r = CX.rng(CX.hash('ref|' + i + '|' + j));
        if (r() < 0.5) {
          var la = (i + 0.15 + r() * 0.7) * CX.CELDA;
          var lo = (j + 0.15 + r() * 0.7) * CX.CELDA;
          var tipo = CX.REFUGIO_TIPOS[Math.floor(r() * CX.REFUGIO_TIPOS.length)];
          var ep = CX.REFUGIO_NOMBRES[Math.floor(r() * CX.REFUGIO_NOMBRES.length)];
          out.push({ id: 'r' + i + '_' + j, lat: la, lon: lo, emoji: tipo.e, nombre: tipo.n + ' ' + ep });
        }
      }
    }
    return out;
  };

  /* ---------- puntaje ---------- */
  // 3 = excelente, 2 = bien, 1 = regular, 0 = falló
  CX.calidad = function (delta, tol) {
    if (delta <= tol) return 3;
    if (delta <= tol * 2.4) return 2;
    if (delta <= tol * 4.2) return 1;
    return 0;
  };

  CX.xpTotalNivel = function (n) { return n <= 1 ? 0 : Math.round(70 * Math.pow(n - 1, 1.7)); };
  CX.nivelPorXp = function (xp) { var n = 1; while (xp >= CX.xpTotalNivel(n + 1)) n++; return n; };

  CX.xpPorFoto = function (esp, calidad, esNueva) {
    var base = CX.RAREZAS[esp.r].xp;
    var mult = calidad === 3 ? 2 : calidad === 2 ? 1.4 : 1;
    return Math.round(base * mult) + (esNueva ? 100 : 0);
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = CX;
})(typeof window !== 'undefined' ? window : globalThis);
