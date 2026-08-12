/**
 * app.js
 * Main application controller for Abstract Painter.
 * Wires together all modules and handles UI interactions.
 * iOS Safari compatible: touch events, safe-area, no Fullscreen API, custom install banner.
 */

'use strict';

import { PaletteManager, PALETTES } from './palette.js';
import { shapeFromJSON } from './geometry.js';
import { CompositionGenerator, CanvasRenderer, DEFAULT_PARAMS } from './renderer.js';
import { AnimationController, ShapeAnimator, CanvasTransition } from './animation.js';
import { ExportManager } from './export.js';
import { StorageManager } from './storage.js';

// ─── iOS Detection ────────────────────────────────────────────────────────────

const IS_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

const IS_SAFARI = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);

const SUPPORTS_FULLSCREEN = !IS_IOS && (
  document.documentElement.requestFullscreen ||
  document.documentElement.webkitRequestFullscreen
);

const SUPPORTS_POINTER_EVENTS = window.PointerEvent != null;

// ─── App State ────────────────────────────────────────────────────────────────

class AbstractPainterApp {
  constructor() {
    // Core modules
    this._palette = new PaletteManager();
    this._storage = new StorageManager();
    this._canvas = null;
    this._renderer = null;
    this._generator = null;
    this._animator = new ShapeAnimator({ staggerDelay: 0.03 });
    this._animCtrl = new AnimationController({ onFrame: (dt, ts) => this._onFrame(dt, ts) });
    this._transition = new CanvasTransition();
    this._exportMgr = null;

    // Composition state
    this._shapes = [];
    this._background = '#1a1a2e';
    this._params = { ...DEFAULT_PARAMS };

    // Undo/redo history
    this._history = [];
    this._historyIdx = -1;
    this._maxHistory = 20;

    // Interaction state — unified for pointer + touch
    this._pointers = new Map();   // pointerId/touchId → {x, y}
    this._lastTap = 0;
    this._tapCount = 0;
    this._longPressTimer = null;
    this._isPanning = false;
    this._panStartX = 0;
    this._panStartY = 0;
    this._panOriginX = 0;
    this._panOriginY = 0;
    this._pinchDist = 0;
    this._currentZoom = 1;

    // UI state
    this._darkMode = true;
    this._uiVisible = true;
    this._galleryOpen = false;
    this._settingsOpen = false;
    this._deferredInstallPrompt = null;
    this._isFullscreen = false;
    this._compositionLocked = false;
  }

  // ─── Init ──────────────────────────────────────────────────────────────────

  init() {
    this._canvas = document.getElementById('main-canvas');
    this._renderer = new CanvasRenderer(this._canvas);
    this._generator = new CompositionGenerator(this._palette);
    this._exportMgr = new ExportManager(this._renderer);

    this._loadSettings();
    this._setupUI();
    this._setupInteractions();
    this._setupResizeObserver();
    this._registerServiceWorker();
    this._setupInstallPrompt();

    this._applyDarkMode(this._darkMode);
    this._setupAnimTypeSelector();

    // Hide fullscreen button on iOS (API not supported)
    if (!SUPPORTS_FULLSCREEN) {
      const btn = document.getElementById('btn-fullscreen');
      if (btn) btn.style.display = 'none';
    }

    this._animCtrl.start();
    this._generatePainting({ pushHistory: false });

    const url = new URL(location.href);
    if (url.searchParams.get('action') === 'new') {
      this._generatePainting({ pushHistory: false });
    }
  }

  // ─── Frame Loop ────────────────────────────────────────────────────────────

  _onFrame(dt) {
    this._transition.update(dt);
    this._animator.update(dt);
    this._renderer.render(this._shapes, this._transition.getOverlayAlpha());
  }

  // ─── Painting Generation ──────────────────────────────────────────────────

  _generatePainting(opts = {}) {
    const { samePalette = false, pushHistory = true } = opts;
    if (this._compositionLocked) return;

    if (!samePalette && !this._palette.isLocked()) {
      if (Math.random() < 0.3) {
        this._palette.randomize();
        this._updatePaletteUI();
      }
    }

    this._background = this._palette.randomBackground();
    this._renderer.setBackground(this._background);

    const shapes = this._generator.generate(
      this._renderer.width,
      this._renderer.height,
      this._params
    );

    ShapeAnimator.assignDrift(shapes);

    const doSwap = () => {
      this._shapes = shapes;
      this._animator.setShapes(this._shapes);
      this._animator.setContinuousMotion(this._animCtrl.isContinuousMotion());
      if (pushHistory) this._pushHistory();
    };

    if (this._shapes.length > 0) {
      this._transition.start(doSwap, 0.35);
    } else {
      doSwap();
    }
  }

  _regenerateSamePalette() {
    if (this._compositionLocked) {
      this._showToast('Composition is locked');
      return;
    }
    this._generatePainting({ samePalette: true, pushHistory: true });
  }

  // ─── History ───────────────────────────────────────────────────────────────

  _pushHistory() {
    if (this._historyIdx < this._history.length - 1) {
      this._history = this._history.slice(0, this._historyIdx + 1);
    }
    this._history.push({
      shapes: this._shapes.map(s => s.toJSON()),
      background: this._background,
      palette: this._palette.serialize(),
      params: { ...this._params }
    });
    if (this._history.length > this._maxHistory) this._history.shift();
    this._historyIdx = this._history.length - 1;
    this._updateUndoRedoButtons();
  }

  _undo() {
    if (this._historyIdx <= 0) return;
    this._historyIdx--;
    this._restoreHistory(this._history[this._historyIdx]);
    this._updateUndoRedoButtons();
  }

  _redo() {
    if (this._historyIdx >= this._history.length - 1) return;
    this._historyIdx++;
    this._restoreHistory(this._history[this._historyIdx]);
    this._updateUndoRedoButtons();
  }

  _restoreHistory(entry) {
    this._palette.deserialize(entry.palette);
    this._updatePaletteUI();
    this._params = { ...entry.params };
    this._syncSlidersToParams();
    this._background = entry.background;
    this._renderer.setBackground(this._background);
    const shapes = entry.shapes.map(d => {
      const s = shapeFromJSON(d);
      s.animProgress = 1;
      return s;
    });
    this._transition.start(() => {
      this._shapes = shapes;
      this._animator.setShapes(this._shapes);
      this._animator.skipIntro();
    }, 0.25);
  }

  _updateUndoRedoButtons() {
    const undoBtn = document.getElementById('btn-undo');
    const redoBtn = document.getElementById('btn-redo');
    if (undoBtn) undoBtn.disabled = this._historyIdx <= 0;
    if (redoBtn) redoBtn.disabled = this._historyIdx >= this._history.length - 1;
  }

  // ─── UI Setup ──────────────────────────────────────────────────────────────

  _setupUI() {
    this._on('btn-generate', 'click', () => {
      this._compositionLocked = false;
      this._generatePainting({ pushHistory: true });
    });

    this._on('btn-undo', 'click', () => this._undo());
    this._on('btn-redo', 'click', () => this._redo());

    // PNG save — iOS-safe
    this._on('btn-save-png', 'click', () => {
      const ts = new Date().toISOString().slice(0, 10);
      this._exportMgr.exportPNG(this._shapes, this._background, `abstract-${ts}.png`);
      this._showToast(IS_IOS ? 'Long-press image to save' : 'PNG saved');
    });

    // SVG export — iOS-safe
    this._on('btn-save-svg', 'click', () => {
      const ts = new Date().toISOString().slice(0, 10);
      this._exportMgr.exportSVG(this._shapes, this._background, `abstract-${ts}.svg`);
      this._showToast(IS_IOS ? 'SVG opened in new tab' : 'SVG exported');
    });

    // Fullscreen — iOS doesn't support it
    this._on('btn-fullscreen', 'click', () => this._toggleFullscreen());
    document.addEventListener('fullscreenchange', () => this._onFullscreenChange());
    document.addEventListener('webkitfullscreenchange', () => this._onFullscreenChange());

    this._on('btn-save-gallery', 'click', () => {
      this._saveToGallery();
      this._showToast('Saved to gallery');
    });

    this._on('btn-gallery', 'click', () => this._toggleGallery());
    this._on('btn-settings', 'click', () => this._toggleSettings());

    this._on('btn-dark-mode', 'click', () => {
      this._darkMode = !this._darkMode;
      this._applyDarkMode(this._darkMode);
      this._saveSettings();
    });

    this._buildPaletteSelector();

    this._on('toggle-motion', 'change', (e) => {
      this._animCtrl.setContinuousMotion(e.target.checked);
      this._animator.setContinuousMotion(e.target.checked);
    });

    this._on('btn-lock', 'click', () => {
      this._compositionLocked = !this._compositionLocked;
      this._updateLockUI();
      this._showToast(this._compositionLocked ? 'Composition locked' : 'Composition unlocked');
    });

    this._setupSliders();
    this._setupBackgroundSelector();

    // iOS Add to Home Screen banner close
    this._on('btn-ios-banner-close', 'click', () => {
      const banner = document.getElementById('ios-install-banner');
      if (banner) banner.style.display = 'none';
      sessionStorage.setItem('iosBannerDismissed', '1');
    });

    // Overlay closes panels
    const overlay = document.getElementById('overlay');
    if (overlay) {
      overlay.addEventListener('click', () => {
        if (this._galleryOpen) this._toggleGallery(false);
        if (this._settingsOpen) this._toggleSettings(false);
      });
    }

    document.addEventListener('keydown', (e) => this._handleKeyboard(e));

    this._on('btn-hide-ui', 'click', () => {
      this._uiVisible = !this._uiVisible;
      const toolbar = document.getElementById('toolbar');
      if (toolbar) toolbar.classList.toggle('hidden', !this._uiVisible);
      const btn = document.getElementById('btn-hide-ui');
      if (btn) btn.textContent = this._uiVisible ? '✕' : '☰';
    });

    this._on('btn-import', 'click', () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json';
      // iOS requires the input to be in the DOM
      input.style.position = 'fixed';
      input.style.opacity = '0';
      input.style.pointerEvents = 'none';
      document.body.appendChild(input);
      input.onchange = (e) => {
        const file = e.target.files[0];
        document.body.removeChild(input);
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
          if (this._storage.importJSON(ev.target.result)) {
            this._showToast('Gallery imported');
            if (this._galleryOpen) this._renderGallery();
          } else {
            this._showToast('Import failed');
          }
        };
        reader.readAsText(file);
      };
      input.click();
    });

    this._on('btn-export-gallery', 'click', () => {
      const json = this._storage.exportJSON();
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      if (IS_IOS) {
        // iOS can't download blobs — open in new tab
        window.open(url, '_blank');
        this._showToast('Open new tab → share to save');
      } else {
        const a = document.createElement('a');
        a.href = url;
        a.download = 'abstract-painter-gallery.json';
        a.click();
      }
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      this._showToast('Gallery exported');
    });

    this._updateUndoRedoButtons();
  }

  // ─── Lock UI ───────────────────────────────────────────────────────────────

  _updateLockUI() {
    const btn = document.getElementById('btn-lock');
    if (btn) {
      btn.setAttribute('aria-pressed', this._compositionLocked.toString());
      btn.classList.toggle('active', this._compositionLocked);
      btn.title = this._compositionLocked ? 'Unlock composition' : 'Lock composition';
      btn.querySelector('.icon').textContent = this._compositionLocked ? '🔒' : '🔓';
    }
    const indicator = document.getElementById('lock-indicator');
    if (indicator) {
      indicator.textContent = this._compositionLocked ? '🔒 Composition locked' : '🔓 Unlocked';
      indicator.classList.add('visible');
      clearTimeout(indicator._timer);
      indicator._timer = setTimeout(() => indicator.classList.remove('visible'), 2000);
    }
  }

  // ─── Sliders ───────────────────────────────────────────────────────────────

  _setupSliders() {
    const sliderDefs = [
      { id: 'slider-count',      param: 'shapeCount',     step: 1    },
      { id: 'slider-density',    param: 'density',        step: 0.01 },
      { id: 'slider-complexity', param: 'complexity',     step: 0.01 },
      { id: 'slider-randomness', param: 'randomness',     step: 0.01 },
      { id: 'slider-opacity',    param: 'opacity',        step: 0.01 },
      { id: 'slider-stroke',     param: 'strokeWidth',    step: 0.5  },
      { id: 'slider-rotation',   param: 'rotationRandom', step: 0.01 },
      { id: 'slider-scale',      param: 'scaleRandom',    step: 0.01 },
      { id: 'slider-noise',      param: 'noiseAmount',    step: 0.01 },
      { id: 'slider-depth',      param: 'depthAmount',    step: 0.01 },
      { id: 'slider-min-size',   param: 'minSize',        step: 1    },
      { id: 'slider-max-size',   param: 'maxSize',        step: 5    },
      { id: 'slider-anim-speed', special: 'animSpeed',   step: 0.1  },
    ];

    for (const def of sliderDefs) {
      const el = document.getElementById(def.id);
      if (!el) continue;

      if (def.special === 'animSpeed') {
        el.value = this._animCtrl._speed;
      } else {
        el.value = this._params[def.param];
      }

      const valEl = document.getElementById(def.id + '-val');
      const update = () => {
        const v = parseFloat(el.value);
        if (valEl) valEl.textContent = def.step >= 1 ? Math.round(v) : v.toFixed(2);
        if (def.special === 'animSpeed') {
          this._animCtrl.setSpeed(v);
        } else {
          this._params[def.param] = v;
        }
      };
      el.addEventListener('input', update);
      update();
    }
  }

  _syncSlidersToParams() {
    const map = {
      'slider-count': 'shapeCount', 'slider-density': 'density',
      'slider-complexity': 'complexity', 'slider-randomness': 'randomness',
      'slider-opacity': 'opacity', 'slider-stroke': 'strokeWidth',
      'slider-rotation': 'rotationRandom', 'slider-scale': 'scaleRandom',
      'slider-noise': 'noiseAmount', 'slider-depth': 'depthAmount',
      'slider-min-size': 'minSize', 'slider-max-size': 'maxSize',
    };
    for (const [id, param] of Object.entries(map)) {
      const el = document.getElementById(id);
      if (el) {
        el.value = this._params[param];
        const valEl = document.getElementById(id + '-val');
        if (valEl) valEl.textContent = this._params[param];
      }
    }
  }

  // ─── Palette UI ────────────────────────────────────────────────────────────

  _buildPaletteSelector() {
    const container = document.getElementById('palette-list');
    if (!container) return;
    container.innerHTML = '';

    const randBtn = this._makePaletteBtn('random', 'Random', ['#FF006E', '#FFBE0B', '#3A86FF', '#06FFB4', '#8338EC']);
    randBtn.addEventListener('click', () => {
      this._palette.randomize();
      this._updatePaletteUI();
    });
    container.appendChild(randBtn);

    for (const [key, def] of Object.entries(PALETTES)) {
      const btn = this._makePaletteBtn(key, def.name, def.colors.slice(0, 5));
      btn.addEventListener('click', () => {
        this._palette.setPalette(key);
        this._updatePaletteUI();
      });
      container.appendChild(btn);
    }
    this._updatePaletteUI();
  }

  _makePaletteBtn(key, name, swatches) {
    const btn = document.createElement('button');
    btn.className = 'palette-btn';
    btn.dataset.key = key;
    btn.setAttribute('aria-label', `${name} palette`);
    btn.setAttribute('role', 'radio');

    const swatchRow = document.createElement('span');
    swatchRow.className = 'palette-swatches';
    for (const color of swatches) {
      const sw = document.createElement('span');
      sw.className = 'swatch';
      sw.style.background = color;
      swatchRow.appendChild(sw);
    }

    const label = document.createElement('span');
    label.className = 'palette-label';
    label.textContent = name;

    btn.appendChild(swatchRow);
    btn.appendChild(label);
    return btn;
  }

  _updatePaletteUI() {
    const currentKey = this._palette.getCurrentKey();
    document.querySelectorAll('.palette-btn').forEach(btn => {
      const active = btn.dataset.key === currentKey;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-checked', active.toString());
    });
  }

  // ─── Background Selector ───────────────────────────────────────────────────

  _setupBackgroundSelector() {
    const container = document.getElementById('bg-colors');
    if (!container) return;

    const presets = [
      '#1a1a2e', '#0f0f1a', '#ffffff', '#f8f8f0',
      '#0d1117', '#fdf6e3', '#1c1c1c', '#2d2d2d',
      '#03045E', '#3d0000', '#1A0F00', '#002200'
    ];

    for (const col of presets) {
      const btn = document.createElement('button');
      btn.className = 'bg-swatch';
      btn.style.background = col;
      btn.setAttribute('aria-label', `Background ${col}`);
      btn.addEventListener('click', () => {
        this._background = col;
        this._renderer.setBackground(col);
        this._params.background = col;
        document.querySelectorAll('.bg-swatch').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
      if (col === this._background) btn.classList.add('active');
      container.appendChild(btn);
    }

    const picker = document.getElementById('bg-color-picker');
    if (picker) {
      picker.value = this._background;
      picker.addEventListener('input', (e) => {
        this._background = e.target.value;
        this._renderer.setBackground(this._background);
        this._params.background = this._background;
      });
    }
  }

  // ─── Animation Type Selector ───────────────────────────────────────────────

  _setupAnimTypeSelector() {
    document.querySelectorAll('input[name="anim-type"]').forEach(r => {
      r.addEventListener('change', (e) => {
        if (e.target.checked) this._params.animType = e.target.value;
      });
      if (r.value === this._params.animType) r.checked = true;
    });
  }

  // ─── Touch / Pointer Interactions ─────────────────────────────────────────
  // Uses PointerEvents on Chrome/Firefox, falls back to TouchEvents on iOS Safari.

  _setupInteractions() {
    const canvas = this._canvas;

    if (SUPPORTS_POINTER_EVENTS) {
      canvas.addEventListener('pointerdown',   (e) => this._onPointerDown(e),   { passive: false });
      canvas.addEventListener('pointermove',   (e) => this._onPointerMove(e),   { passive: false });
      canvas.addEventListener('pointerup',     (e) => this._onPointerUp(e),     { passive: false });
      canvas.addEventListener('pointercancel', (e) => this._onPointerUp(e),     { passive: false });
    } else {
      // iOS Safari touch fallback
      canvas.addEventListener('touchstart',  (e) => this._onTouchStart(e),  { passive: false });
      canvas.addEventListener('touchmove',   (e) => this._onTouchMove(e),   { passive: false });
      canvas.addEventListener('touchend',    (e) => this._onTouchEnd(e),    { passive: false });
      canvas.addEventListener('touchcancel', (e) => this._onTouchEnd(e),    { passive: false });
    }

    canvas.addEventListener('wheel', (e) => this._onWheel(e), { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // ── Pointer Events (Chrome, Firefox, Android) ──────────────────────────────

  _onPointerDown(e) {
    e.preventDefault();
    this._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (this._pointers.size === 1) {
      this._isPanning = false;
      this._panStartX = e.clientX;
      this._panStartY = e.clientY;
      this._panOriginX = this._renderer._panX;
      this._panOriginY = this._renderer._panY;
      this._longPressTimer = setTimeout(() => {
        this._longPressTimer = null;
        this._onLongPress();
      }, 800);
    } else if (this._pointers.size === 2) {
      clearTimeout(this._longPressTimer);
      this._pinchDist = this._distance(...this._pointers.values());
    }
  }

  _onPointerMove(e) {
    e.preventDefault();
    if (!this._pointers.has(e.pointerId)) return;
    this._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this._handleMoveLogic();
  }

  _onPointerUp(e) {
    const wasPanning = this._isPanning;
    clearTimeout(this._longPressTimer);
    this._pointers.delete(e.pointerId);
    this._handleUpLogic(wasPanning);
  }

  // ── Touch Events (iOS Safari fallback) ────────────────────────────────────

  _onTouchStart(e) {
    e.preventDefault();
    for (const t of e.changedTouches) {
      this._pointers.set(t.identifier, { x: t.clientX, y: t.clientY });
    }

    if (this._pointers.size === 1) {
      const first = e.changedTouches[0];
      this._isPanning = false;
      this._panStartX = first.clientX;
      this._panStartY = first.clientY;
      this._panOriginX = this._renderer._panX;
      this._panOriginY = this._renderer._panY;
      this._longPressTimer = setTimeout(() => {
        this._longPressTimer = null;
        this._onLongPress();
      }, 800);
    } else if (this._pointers.size === 2) {
      clearTimeout(this._longPressTimer);
      this._pinchDist = this._distance(...this._pointers.values());
    }
  }

  _onTouchMove(e) {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (this._pointers.has(t.identifier)) {
        this._pointers.set(t.identifier, { x: t.clientX, y: t.clientY });
      }
    }
    this._handleMoveLogic();
  }

  _onTouchEnd(e) {
    const wasPanning = this._isPanning;
    clearTimeout(this._longPressTimer);
    for (const t of e.changedTouches) {
      this._pointers.delete(t.identifier);
    }
    this._handleUpLogic(wasPanning);
  }

  // ── Shared move/up logic ───────────────────────────────────────────────────

  _handleMoveLogic() {
    if (this._pointers.size === 1) {
      const [p] = this._pointers.values();
      const dx = p.x - this._panStartX;
      const dy = p.y - this._panStartY;

      if (!this._isPanning && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
        clearTimeout(this._longPressTimer);
        this._isPanning = true;
      }
      if (this._isPanning) {
        this._renderer.setPan(this._panOriginX + dx, this._panOriginY + dy);
      }
    } else if (this._pointers.size === 2) {
      const newDist = this._distance(...this._pointers.values());
      if (this._pinchDist > 0) {
        this._currentZoom = Math.min(5, Math.max(0.2, this._currentZoom * (newDist / this._pinchDist)));
        this._renderer.setZoom(this._currentZoom);
        this._pinchDist = newDist;
      }
    }
  }

  _handleUpLogic(wasPanning) {
    if (this._pointers.size === 0 && !wasPanning) {
      const now = Date.now();
      this._tapCount = (now - this._lastTap < 350) ? this._tapCount + 1 : 1;
      this._lastTap = now;

      if (this._tapCount >= 2) {
        this._tapCount = 0;
        this._regenerateSamePalette();
      } else {
        setTimeout(() => {
          if (this._tapCount === 1) {
            this._tapCount = 0;
            if (!this._galleryOpen && !this._settingsOpen) {
              this._generatePainting({ pushHistory: true });
            }
          }
        }, 350);
      }
    }
    if (this._pointers.size < 2) this._pinchDist = 0;
    if (this._pointers.size === 0) this._isPanning = false;
  }

  _onWheel(e) {
    e.preventDefault();
    this._currentZoom = Math.min(5, Math.max(0.2, this._currentZoom * (e.deltaY < 0 ? 1.05 : 0.95)));
    this._renderer.setZoom(this._currentZoom);
  }

  _onLongPress() {
    if (!this._isPanning) {
      this._compositionLocked = !this._compositionLocked;
      this._updateLockUI();
    }
  }

  _distance(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  // ─── Keyboard ──────────────────────────────────────────────────────────────

  _handleKeyboard(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    switch (e.key) {
      case ' ': case 'Enter':
        e.preventDefault();
        this._generatePainting({ pushHistory: true });
        break;
      case 'z': case 'Z':
        if (e.metaKey || e.ctrlKey) {
          e.preventDefault();
          e.shiftKey ? this._redo() : this._undo();
        }
        break;
      case 'y': case 'Y':
        if (e.metaKey || e.ctrlKey) { e.preventDefault(); this._redo(); }
        break;
      case 's': case 'S':
        if (e.metaKey || e.ctrlKey) {
          e.preventDefault();
          this._saveToGallery();
          this._showToast('Saved to gallery');
        }
        break;
      case 'f': case 'F':
        if (!e.metaKey && !e.ctrlKey) this._toggleFullscreen();
        break;
      case 'Escape':
        if (this._galleryOpen) this._toggleGallery(false);
        else if (this._settingsOpen) this._toggleSettings(false);
        break;
      case '0':
        this._renderer.resetTransform();
        this._currentZoom = 1;
        break;
      case '+': case '=':
        this._currentZoom = Math.min(5, this._currentZoom * 1.2);
        this._renderer.setZoom(this._currentZoom);
        break;
      case '-':
        this._currentZoom = Math.max(0.2, this._currentZoom / 1.2);
        this._renderer.setZoom(this._currentZoom);
        break;
    }
  }

  // ─── Resize ────────────────────────────────────────────────────────────────

  _setupResizeObserver() {
    let resizeTimer = null;
    const onResize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        this._renderer.resize();
        if (this._shapes.length > 0) {
          this._generatePainting({ samePalette: true, pushHistory: false });
        }
      }, 150);
    };

    new ResizeObserver(onResize).observe(document.documentElement);

    // visualViewport is the correct API for iOS (handles keyboard, safe areas)
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', onResize);
    }

    // Legacy fallback
    window.addEventListener('orientationchange', () => setTimeout(onResize, 300));
  }

  // ─── Gallery ───────────────────────────────────────────────────────────────

  _toggleGallery(force) {
    this._galleryOpen = force !== undefined ? force : !this._galleryOpen;
    const panel = document.getElementById('gallery-panel');
    if (panel) {
      panel.classList.toggle('open', this._galleryOpen);
      panel.setAttribute('aria-hidden', (!this._galleryOpen).toString());
    }
    document.getElementById('overlay')?.classList.toggle('active', this._galleryOpen || this._settingsOpen);
    document.getElementById('btn-gallery')?.setAttribute('aria-expanded', this._galleryOpen.toString());

    if (this._galleryOpen) {
      if (this._settingsOpen) this._toggleSettings(false);
      this._renderGallery();
      const countEl = document.getElementById('gallery-count');
      if (countEl) countEl.textContent = `(${this._storage.count})`;
    }
  }

  _renderGallery() {
    const grid = document.getElementById('gallery-grid');
    if (!grid) return;
    grid.innerHTML = '';

    const paintings = this._storage.getGallery();
    if (paintings.length === 0) {
      grid.innerHTML = '<p class="gallery-empty">No saved paintings yet.<br>Tap ♡ to save one.</p>';
      return;
    }

    for (const painting of paintings) {
      const card = document.createElement('div');
      card.className = 'gallery-card';
      card.setAttribute('tabindex', '0');
      card.setAttribute('role', 'listitem');
      card.setAttribute('aria-label', painting.name);

      const thumb = document.createElement('div');
      thumb.className = 'gallery-thumb';
      if (painting.thumbnail) {
        const img = document.createElement('img');
        img.src = painting.thumbnail;
        img.alt = painting.name;
        img.loading = 'lazy';
        img.decoding = 'async';
        thumb.appendChild(img);
      }

      const info = document.createElement('div');
      info.className = 'gallery-info';

      const name = document.createElement('span');
      name.className = 'gallery-name';
      name.textContent = painting.name;

      const date = document.createElement('span');
      date.className = 'gallery-date';
      date.textContent = new Date(painting.createdAt).toLocaleDateString();

      const actions = document.createElement('div');
      actions.className = 'gallery-actions';

      const loadBtn = document.createElement('button');
      loadBtn.textContent = 'Load';
      loadBtn.setAttribute('aria-label', `Load ${painting.name}`);
      loadBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._loadPainting(painting);
        this._toggleGallery(false);
      });

      const renameBtn = document.createElement('button');
      renameBtn.textContent = 'Rename';
      renameBtn.setAttribute('aria-label', `Rename ${painting.name}`);
      renameBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const newName = prompt('New name:', painting.name);
        if (newName?.trim()) {
          this._storage.renamePainting(painting.id, newName.trim());
          this._renderGallery();
        }
      });

      const deleteBtn = document.createElement('button');
      deleteBtn.textContent = 'Delete';
      deleteBtn.className = 'btn-danger';
      deleteBtn.setAttribute('aria-label', `Delete ${painting.name}`);
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (confirm(`Delete "${painting.name}"?`)) {
          this._storage.deletePainting(painting.id);
          this._renderGallery();
        }
      });

      actions.append(loadBtn, renameBtn, deleteBtn);
      info.append(name, date, actions);
      card.append(thumb, info);
      grid.appendChild(card);

      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { this._loadPainting(painting); this._toggleGallery(false); }
      });
    }
  }

  _loadPainting(painting) {
    this._palette.deserialize(painting.palette);
    this._updatePaletteUI();
    this._params = { ...painting.params };
    this._syncSlidersToParams();
    this._background = painting.background;
    this._renderer.setBackground(this._background);
    const shapes = painting.shapes.map(d => { const s = shapeFromJSON(d); s.animProgress = 1; return s; });
    this._transition.start(() => {
      this._shapes = shapes;
      this._animator.setShapes(this._shapes);
      this._animator.skipIntro();
    }, 0.3);
  }

  _saveToGallery() {
    this._storage.savePainting({
      shapes: this._shapes,
      background: this._background,
      palette: this._palette.serialize(),
      params: this._params,
      canvas: this._renderer.canvas
    });
    if (this._galleryOpen) this._renderGallery();
  }

  // ─── Settings Panel ────────────────────────────────────────────────────────

  _toggleSettings(force) {
    this._settingsOpen = force !== undefined ? force : !this._settingsOpen;
    const panel = document.getElementById('settings-panel');
    if (panel) {
      panel.classList.toggle('open', this._settingsOpen);
      panel.setAttribute('aria-hidden', (!this._settingsOpen).toString());
    }
    document.getElementById('overlay')?.classList.toggle('active', this._galleryOpen || this._settingsOpen);
    document.getElementById('btn-settings')?.setAttribute('aria-expanded', this._settingsOpen.toString());
    if (this._settingsOpen && this._galleryOpen) this._toggleGallery(false);
  }

  // ─── Dark Mode ─────────────────────────────────────────────────────────────

  _applyDarkMode(dark) {
    document.documentElement.classList.toggle('dark', dark);
    document.documentElement.classList.toggle('light', !dark);
    const btn = document.getElementById('btn-dark-mode');
    if (btn) {
      btn.setAttribute('aria-pressed', dark.toString());
      btn.title = dark ? 'Switch to light mode' : 'Switch to dark mode';
      btn.querySelector('.icon').textContent = dark ? '☀️' : '🌙';
    }
  }

  // ─── Fullscreen ────────────────────────────────────────────────────────────

  _toggleFullscreen() {
    if (!SUPPORTS_FULLSCREEN) return;
    const el = document.documentElement;
    if (document.fullscreenElement || document.webkitFullscreenElement) {
      (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    } else {
      (el.requestFullscreen || el.webkitRequestFullscreen).call(el);
    }
  }

  _onFullscreenChange() {
    this._isFullscreen = !!(document.fullscreenElement || document.webkitFullscreenElement);
    const btn = document.getElementById('btn-fullscreen');
    if (!btn) return;
    btn.setAttribute('aria-label', this._isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen');
    btn.querySelector('.icon').textContent = this._isFullscreen ? '✕' : '⛶';
  }

  // ─── Toast ─────────────────────────────────────────────────────────────────

  _showToast(msg, duration = 2500) {
    let toast = document.getElementById('toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'toast';
      toast.setAttribute('role', 'status');
      toast.setAttribute('aria-live', 'polite');
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => toast.classList.remove('show'), duration);
  }

  // ─── Service Worker ────────────────────────────────────────────────────────

  _registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      // Relative path keeps the SW in the correct scope regardless of origin
      navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(err => {
        console.warn('SW registration failed:', err);
      });
    }
  }

  // ─── Install Prompt ────────────────────────────────────────────────────────

  _setupInstallPrompt() {
    // Android / Chrome — standard beforeinstallprompt
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this._deferredInstallPrompt = e;
      const btn = document.getElementById('btn-install');
      if (btn) btn.style.display = 'flex';
    });

    this._on('btn-install', 'click', async () => {
      if (!this._deferredInstallPrompt) return;
      this._deferredInstallPrompt.prompt();
      await this._deferredInstallPrompt.userChoice;
      this._deferredInstallPrompt = null;
      const btn = document.getElementById('btn-install');
      if (btn) btn.style.display = 'none';
    });

    window.addEventListener('appinstalled', () => {
      this._deferredInstallPrompt = null;
      const btn = document.getElementById('btn-install');
      if (btn) btn.style.display = 'none';
      this._showToast('App installed!');
    });

    // iOS Safari — no beforeinstallprompt, show custom banner
    if (IS_IOS && IS_SAFARI) {
      const isStandalone = window.navigator.standalone === true;
      const dismissed = sessionStorage.getItem('iosBannerDismissed');
      if (!isStandalone && !dismissed) {
        // Delay so the app renders first
        setTimeout(() => {
          const banner = document.getElementById('ios-install-banner');
          if (banner) banner.style.display = 'flex';
        }, 2500);
      }
    }
  }

  // ─── Settings Persistence ──────────────────────────────────────────────────

  _saveSettings() {
    this._storage.saveSettings({
      darkMode: this._darkMode,
      params: this._params,
      paletteKey: this._palette.getCurrentKey(),
      animSpeed: this._animCtrl._speed,
      continuousMotion: this._animCtrl.isContinuousMotion()
    });
  }

  _loadSettings() {
    const s = this._storage.loadSettings();
    if (s.darkMode !== undefined) this._darkMode = s.darkMode;
    if (s.params) this._params = { ...DEFAULT_PARAMS, ...s.params };
    if (s.paletteKey) this._palette.setPalette(s.paletteKey);
    if (s.animSpeed !== undefined) this._animCtrl.setSpeed(s.animSpeed);
    if (s.continuousMotion !== undefined) {
      this._animCtrl.setContinuousMotion(s.continuousMotion);
      this._animator.setContinuousMotion(s.continuousMotion);
    }
  }

  // ─── Utility ───────────────────────────────────────────────────────────────

  _on(id, event, handler) {
    document.getElementById(id)?.addEventListener(event, handler);
  }
}

// ─── Bootstrap ───────────────────────────────────────────────────────────────

const app = new AbstractPainterApp();
app.init();
