/* Chilenodex — mapa propio en canvas con mosaicos de OpenStreetMap.
 * Sin dependencias. Si no hay conexión, dibuja una cuadrícula y el juego sigue funcionando.
 */
(function (root) {
  'use strict';
  var CX = root.CX = root.CX || {};
  var TS = 256;

  function lonToX(lon, z) { return (lon + 180) / 360 * Math.pow(2, z) * TS; }
  function latToY(lat, z) {
    var s = Math.sin(lat * Math.PI / 180);
    return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * Math.pow(2, z) * TS;
  }
  function xToLon(x, z) { return x / (TS * Math.pow(2, z)) * 360 - 180; }
  function yToLat(y, z) {
    var n = Math.PI - 2 * Math.PI * y / (TS * Math.pow(2, z));
    return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  }

  function MapView(canvas, opts) {
    opts = opts || {};
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.lat = opts.lat; this.lon = opts.lon;
    this.z = opts.z || 17.4;
    this.minZ = 15.5; this.maxZ = 19;
    this.tileUrl = opts.tileUrl || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
    this.cache = new Map();
    this.follow = true;
    this.onTap = null;
    this.onUserPan = null;
    this.W = 0; this.H = 0; this.dpr = 1;
    this.tilesOk = 0; this.tilesFail = 0;
    this._ptrs = new Map();
    this._gesture = null;
    this.resize();
    this._bind();
  }

  MapView.prototype.resize = function () {
    var r = this.cv.getBoundingClientRect();
    this.dpr = Math.min(root.devicePixelRatio || 1, 2.5);
    this.W = Math.max(1, r.width); this.H = Math.max(1, r.height);
    this.cv.width = Math.round(this.W * this.dpr);
    this.cv.height = Math.round(this.H * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  };

  MapView.prototype.metrosPorPixel = function (lat) {
    return 156543.03392 * Math.cos((lat == null ? this.lat : lat) * Math.PI / 180) / Math.pow(2, this.z);
  };

  MapView.prototype.aPantalla = function (lat, lon) {
    var cx = lonToX(this.lon, this.z), cy = latToY(this.lat, this.z);
    return { x: this.W / 2 + (lonToX(lon, this.z) - cx), y: this.H / 2 + (latToY(lat, this.z) - cy) };
  };

  MapView.prototype.aCoord = function (x, y) {
    var cx = lonToX(this.lon, this.z), cy = latToY(this.lat, this.z);
    return { lat: yToLat(cy + (y - this.H / 2), this.z), lon: xToLon(cx + (x - this.W / 2), this.z) };
  };

  MapView.prototype.setZoom = function (z) {
    this.z = Math.max(this.minZ, Math.min(this.maxZ, z));
  };

  MapView.prototype.centrarEn = function (lat, lon) { this.lat = lat; this.lon = lon; };

  MapView.prototype._tile = function (z, x, y) {
    var key = z + '/' + x + '/' + y, t = this.cache.get(key), self = this;
    if (t) return t;
    var img = new Image();
    t = { img: img, ok: false, fail: false };
    img.onload = function () { t.ok = true; self.tilesOk++; };
    img.onerror = function () { t.fail = true; self.tilesFail++; };
    img.decoding = 'async';
    img.src = this.tileUrl.replace('{z}', z).replace('{x}', x).replace('{y}', y);
    this.cache.set(key, t);
    if (this.cache.size > 260) {
      var k0 = this.cache.keys().next().value;
      this.cache.delete(k0);
    }
    return t;
  };

  // Dibuja fondo + mosaicos + tinte "de juego".
  MapView.prototype.dibujaBase = function () {
    var ctx = this.ctx, W = this.W, H = this.H;
    ctx.fillStyle = '#d9e6d3';
    ctx.fillRect(0, 0, W, H);

    var tz = Math.floor(this.z), s = Math.pow(2, this.z - tz);
    var cx = lonToX(this.lon, tz), cy = latToY(this.lat, tz);
    var left = cx - W / 2 / s, top = cy - H / 2 / s, right = cx + W / 2 / s, bottom = cy + H / 2 / s;
    var n = Math.pow(2, tz);
    var x0 = Math.floor(left / TS), x1 = Math.floor(right / TS);
    var y0 = Math.floor(top / TS), y1 = Math.floor(bottom / TS);
    var tam = TS * s + 0.6, algunoOk = false;

    for (var ty = y0; ty <= y1; ty++) {
      if (ty < 0 || ty >= n) continue;
      for (var tx = x0; tx <= x1; tx++) {
        var wx = ((tx % n) + n) % n;
        var t = this._tile(tz, wx, ty);
        var sx = W / 2 + (tx * TS - cx) * s, sy = H / 2 + (ty * TS - cy) * s;
        if (t.ok) { ctx.drawImage(t.img, sx, sy, tam, tam); algunoOk = true; }
        else {
          ctx.strokeStyle = 'rgba(60,110,80,.16)';
          ctx.lineWidth = 1;
          ctx.strokeRect(sx + .5, sy + .5, tam - 1, tam - 1);
        }
      }
    }
    this.sinMapa = !algunoOk;

    // tinte verdoso para unificar el estilo
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = 'rgba(205, 232, 212, 0.55)';
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  };

  /* ---------- gestos ---------- */
  MapView.prototype._bind = function () {
    var self = this, cv = this.cv;
    cv.style.touchAction = 'none';

    cv.addEventListener('pointerdown', function (e) {
      cv.setPointerCapture(e.pointerId);
      self._ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (self._ptrs.size === 1) {
        self._gesture = { tipo: 'pan', sx: e.clientX, sy: e.clientY, mov: 0, t: Date.now() };
      } else if (self._ptrs.size === 2) {
        var p = Array.from(self._ptrs.values());
        self._gesture = { tipo: 'pinch', d0: Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y), z0: self.z, mov: 99 };
      }
    });

    cv.addEventListener('pointermove', function (e) {
      var prev = self._ptrs.get(e.pointerId);
      if (!prev) return;
      var g = self._gesture;
      if (self._ptrs.size >= 2 && g && g.tipo === 'pinch') {
        self._ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
        var p = Array.from(self._ptrs.values());
        var d = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
        if (g.d0 > 0) self.setZoom(g.z0 + Math.log(d / g.d0) / Math.LN2);
        return;
      }
      var dx = e.clientX - prev.x, dy = e.clientY - prev.y;
      self._ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (!g || g.tipo !== 'pan') return;
      g.mov += Math.abs(dx) + Math.abs(dy);
      if (g.mov > 10) {
        var cx = lonToX(self.lon, self.z) - dx, cy = latToY(self.lat, self.z) - dy;
        self.lon = xToLon(cx, self.z); self.lat = yToLat(cy, self.z);
        if (self.follow) { self.follow = false; if (self.onUserPan) self.onUserPan(); }
      }
    });

    function fin(e) {
      var g = self._gesture;
      var eraUnico = self._ptrs.size === 1;
      self._ptrs.delete(e.pointerId);
      if (g && g.tipo === 'pan' && eraUnico && g.mov <= 10 && Date.now() - g.t < 700 && e.type === 'pointerup') {
        var r = cv.getBoundingClientRect();
        if (self.onTap) self.onTap(e.clientX - r.left, e.clientY - r.top);
      }
      if (self._ptrs.size === 0) self._gesture = null;
      else if (self._ptrs.size === 1) {
        var q = Array.from(self._ptrs.values())[0];
        self._gesture = { tipo: 'pan', sx: q.x, sy: q.y, mov: 99, t: 0 };
      }
    }
    cv.addEventListener('pointerup', fin);
    cv.addEventListener('pointercancel', fin);

    cv.addEventListener('wheel', function (e) {
      e.preventDefault();
      self.setZoom(self.z - Math.sign(e.deltaY) * 0.3);
    }, { passive: false });
  };

  CX.MapView = MapView;
  CX.mapaUtil = { lonToX: lonToX, latToY: latToY, xToLon: xToLon, yToLat: yToLat };
})(typeof window !== 'undefined' ? window : globalThis);
