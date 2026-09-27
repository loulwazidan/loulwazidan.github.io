/* Tiny runtime that plays the portfolio's page designs as a real website.
   Each page ships a desktop and a mobile layout; the right one is chosen by
   screen width and scaled to fill the window. */
(function () {
  'use strict';

  var HOLE = /\{\{\s*([^}]+?)\s*\}\}/g;
  var WHOLE = /^\s*\{\{\s*([^}]+?)\s*\}\}\s*$/;
  var BOOL_ATTRS = { autoplay: 1, muted: 1, loop: 1, playsinline: 1, controls: 1, disabled: 1, checked: 1 };

  function lookup(path, scope) {
    path = path.trim();
    if (path === 'true') return true;
    if (path === 'false') return false;
    if (path === 'null') return null;
    if (/^-?\d+(\.\d+)?$/.test(path)) return parseFloat(path);
    if (/^'.*'$|^".*"$/.test(path)) return path.slice(1, -1);
    var parts = path.split('.');
    var v = scope[parts[0]];
    for (var i = 1; i < parts.length && v != null; i++) v = v[parts[i]];
    return v;
  }
  function interp(str, scope) {
    return str.replace(HOLE, function (_, p) { var v = lookup(p, scope); return v == null ? '' : String(v); });
  }
  function extend(scope, key, val, idx) {
    var s = Object.create(scope);
    s[key] = val; s.$index = idx;
    return s;
  }

  /* ---- build live nodes from template nodes; each returns {nodes, update} ---- */
  function buildList(tplNodes, scope) {
    var parts = [];
    for (var i = 0; i < tplNodes.length; i++) {
      var p = buildNode(tplNodes[i], scope);
      if (p) parts.push(p);
    }
    return {
      nodes: function () { var out = []; parts.forEach(function (p) { out.push.apply(out, p.nodes()); }); return out; },
      update: function (sc) { parts.forEach(function (p) { p.update(sc); }); },
      destroy: function () { parts.forEach(function (p) { p.destroy && p.destroy(); }); }
    };
  }

  function buildNode(t, scope) {
    if (t.nodeType === 3) {
      var txt = t.nodeValue;
      var node = document.createTextNode('');
      if (txt.indexOf('{{') === -1) { node.nodeValue = txt; return { nodes: function () { return [node]; }, update: function () {} }; }
      var last = null;
      var upd = function (sc) { var v = interp(txt, sc); if (v !== last) { node.nodeValue = v; last = v; } };
      upd(scope);
      return { nodes: function () { return [node]; }, update: upd };
    }
    if (t.nodeType !== 1) return null;
    var tag = t.tagName.toLowerCase();
    if (tag === 'sc-if') return buildIf(t, scope);
    if (tag === 'sc-for') return buildFor(t, scope);
    return buildEl(t, scope);
  }

  function buildIf(t, scope) {
    var cond = WHOLE.exec(t.getAttribute('value') || '');
    var marker = document.createComment('if');
    var inner = null, frag = [marker];
    var kids = Array.prototype.slice.call(t.childNodes);
    function upd(sc) {
      var on = !!(cond ? lookup(cond[1], sc) : false);
      if (on && !inner) {
        inner = buildList(kids, sc);
        var parent = marker.parentNode;
        if (parent) inner.nodes().forEach(function (n) { parent.insertBefore(n, marker); });
      } else if (!on && inner) {
        inner.nodes().forEach(function (n) { n.parentNode && n.parentNode.removeChild(n); });
        inner.destroy(); inner = null;
      } else if (on && inner) inner.update(sc);
    }
    var first = true;
    return {
      nodes: function () {
        if (first) { first = false; var on = !!(cond ? lookup(cond[1], scope) : false); if (on) inner = buildList(kids, scope); }
        return (inner ? inner.nodes() : []).concat([marker]);
      },
      update: upd,
      destroy: function () { inner && inner.destroy(); }
    };
  }

  function buildFor(t, scope) {
    var listM = WHOLE.exec(t.getAttribute('list') || '');
    var as = t.getAttribute('as') || 'item';
    var marker = document.createComment('for');
    var kids = Array.prototype.slice.call(t.childNodes);
    var rows = [];
    function getList(sc) { var l = listM ? lookup(listM[1], sc) : []; return Array.isArray(l) ? l : []; }
    var initial = getList(scope);
    initial.forEach(function (it, i) { rows.push(buildList(kids, extend(scope, as, it, i))); });
    function upd(sc) {
      var list = getList(sc);
      var parent = marker.parentNode;
      while (rows.length > list.length) {
        var r = rows.pop(); r.nodes().forEach(function (n) { n.parentNode && n.parentNode.removeChild(n); }); r.destroy();
      }
      for (var i = 0; i < list.length; i++) {
        var s = extend(sc, as, list[i], i);
        if (i < rows.length) rows[i].update(s);
        else {
          var nr = buildList(kids, s); rows.push(nr);
          if (parent) nr.nodes().forEach(function (n) { parent.insertBefore(n, marker); });
        }
      }
    }
    return {
      nodes: function () { var out = []; rows.forEach(function (r) { out.push.apply(out, r.nodes()); }); out.push(marker); return out; },
      update: upd,
      destroy: function () { rows.forEach(function (r) { r.destroy(); }); }
    };
  }

  function buildEl(t, scope) {
    var tag = t.tagName.toLowerCase();
    var isSvg = t.namespaceURI === 'http://www.w3.org/2000/svg';
    var el = isSvg ? document.createElementNS('http://www.w3.org/2000/svg', t.tagName) : document.createElement(tag);
    var binds = [], handlers = {};
    Array.prototype.forEach.call(t.attributes, function (a) {
      var name = a.name, val = a.value;
      if (name.indexOf('hint-') === 0) return;
      var whole = WHOLE.exec(val);
      if (/^on[a-z]+$/.test(name) && whole) {
        var evt = name.slice(2);
        handlers[evt] = whole[1];
        return;
      }
      if (whole) binds.push({ name: name, path: whole[1], whole: true, last: undefined });
      else if (val.indexOf('{{') !== -1) binds.push({ name: name, tpl: val, last: undefined });
      else el.setAttribute(name, val);
    });
    var current = {};
    Object.keys(handlers).forEach(function (evt) {
      el.addEventListener(evt, function (e) { var f = current[evt]; if (typeof f === 'function') f(e); }, evt === 'wheel' || evt.indexOf('touch') === 0 ? { passive: true } : false);
    });
    if (Object.keys(handlers).length) el.__dcHandlers = current;
    function setAttr(b, v) {
      if (b.whole) {
        if (BOOL_ATTRS[b.name]) {
          if (v) el.setAttribute(b.name, ''); else el.removeAttribute(b.name);
          if (b.name === 'muted') el.muted = !!v;
          return;
        }
        if (v == null || v === false) { el.removeAttribute(b.name); return; }
        el.setAttribute(b.name, String(v));
      } else el.setAttribute(b.name, v);
    }
    function upd(sc) {
      for (var i = 0; i < binds.length; i++) {
        var b = binds[i];
        var v = b.whole ? lookup(b.path, sc) : interp(b.tpl, sc);
        if (v !== b.last) { b.last = v; setAttr(b, v); }
      }
      for (var evt in handlers) current[evt] = lookup(handlers[evt], sc);
    }
    upd(scope);
    var src = tag === 'template' ? t.content.childNodes : t.childNodes;
    var kids = buildList(Array.prototype.slice.call(src), scope);
    kids.nodes().forEach(function (n) { el.appendChild(n); });
    return {
      nodes: function () { return [el]; },
      update: function (sc) { upd(sc); kids.update(sc); },
      destroy: function () { kids.destroy(); },
      el: el
    };
  }

  /* ---- component base ---- */
  function DCLogic() {}
  DCLogic.prototype.setState = function (patch) {
    this.state = Object.assign({}, this.state || {}, typeof patch === 'function' ? patch(this.state) : patch);
    this.__schedule && this.__schedule();
  };
  DCLogic.prototype.forceUpdate = function () { this.__schedule && this.__schedule(); };

  /* ---- page mounting ---- */
  var mounted = null;
  var cfg = window.__DC_PAGE;

  function pick() { return window.innerWidth < 760 ? 'mobile' : 'desktop'; }

  function mount(which) {
    var spec = cfg[which];
    var stage = document.getElementById('stage');
    if (mounted) {
      try { mounted.inst.componentWillUnmount && mounted.inst.componentWillUnmount(); } catch (e) {}
      mounted.tree.destroy(); stage.innerHTML = '';
    }
    var W = spec.w, scale = window.innerWidth / W;
    var Hh = Math.max(Math.round(window.innerHeight / scale), 200);
    window.__DC_H = Hh;
    var Comp = new Function('DCLogic', spec.js + '\n;return Component;')(DCLogic);
    var inst = new Comp();
    inst.props = spec.props;
    var tpl = document.getElementById(spec.tpl);
    var scheduled = false, tree;
    function vals() { var v = inst.renderVals() || {}; v.__H = Hh; return v; }
    inst.__schedule = function () {
      if (scheduled) return; scheduled = true;
      Promise.resolve().then(function () { scheduled = false; tree && tree.update(vals()); });
    };
    tree = buildList(Array.prototype.slice.call(tpl.content.childNodes), vals());
    var wrap = document.createElement('div');
    wrap.className = 'dc-scale';
    wrap.style.width = W + 'px';
    wrap.style.height = Hh + 'px';
    wrap.style.transform = 'scale(' + scale + ')';
    tree.nodes().forEach(function (n) { wrap.appendChild(n); });
    stage.appendChild(wrap);
    mounted = { which: which, inst: inst, tree: tree, scale: scale, root: wrap.querySelector('div') };
    if (inst.componentDidMount) inst.componentDidMount();
  }

  function rootHandlers() { return mounted && mounted.root && mounted.root.__dcHandlers || {}; }
  function wheel(dy) { var h = rootHandlers(); if (typeof h.wheel === 'function') h.wheel({ deltaY: dy, preventDefault: function () {} }); }

  /* touch → wheel fallback for layouts without their own touch handlers */
  var ty = null;
  window.addEventListener('touchstart', function (e) {
    if (typeof rootHandlers().touchmove === 'function') return;
    ty = e.touches[0].clientY;
  }, { passive: true });
  window.addEventListener('touchmove', function (e) {
    if (typeof rootHandlers().touchmove === 'function' || ty == null) return;
    var y = e.touches[0].clientY; wheel((ty - y) * 1.6 / (mounted ? mounted.scale : 1)); ty = y;
  }, { passive: true });
  window.addEventListener('keydown', function (e) {
    var k = e.key, step = 0;
    if (k === 'ArrowDown') step = 80; else if (k === 'ArrowUp') step = -80;
    else if (k === 'PageDown' || (k === ' ' && !e.shiftKey)) step = window.innerHeight * 0.8;
    else if (k === 'PageUp' || (k === ' ' && e.shiftKey)) step = -window.innerHeight * 0.8;
    if (step) { e.preventDefault(); wheel(step); }
  });

  var rt;
  window.addEventListener('resize', function () {
    clearTimeout(rt);
    rt = setTimeout(function () { mount(pick()); }, 180);
  });

  document.addEventListener('DOMContentLoaded', function () { mount(pick()); });
})();
