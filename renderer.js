/**
 * renderer.js
 * Composition generator and canvas renderer for Abstract Painter.
 * Generates balanced, depth-layered abstract compositions.
 */

'use strict';

import {
  rnd, rndInt, clamp,
  CircleShape, RingShape, LineShape, ArcShape,
  TriangleShape, RectShape, PolygonShape, DotShape,
  CurveShape, SplineShape, StarburstShape
} from './geometry.js';
import { hexToRgba, shiftColor } from './palette.js';
import { ShapeAnimator } from './animation.js';
import { buildCanvasFilter, DEFAULT_EFFECTS } from './effects.mjs';

// ─── Composition Parameters ───────────────────────────────────────────────────

/**
 * @typedef {object} CompositionParams
 * @property {number} shapeCount     - Total shapes (10..200)
 * @property {number} minSize        - Minimum shape size in logical px
 * @property {number} maxSize        - Maximum shape size in logical px
 * @property {number} strokeWidth    - Stroke width multiplier
 * @property {number} opacity        - Global opacity 0..1
 * @property {number} rotationRandom - How random rotations are 0..1
 * @property {number} scaleRandom    - Scale variation 0..1
 * @property {number} colorRandom    - Color randomness 0..1
 * @property {number} noiseAmount    - Position jitter 0..1
 * @property {number} depthAmount    - Depth layering intensity 0..1
 * @property {number} density        - Shape density factor 0..1
 * @property {number} complexity     - Composition complexity 0..1
 * @property {number} randomness     - Overall randomness 0..1
 * @property {string} background     - Background color
 * @property {string} animType       - 'fadeIn'|'scaleIn'|'rotateIn'|'none'
 */

const DEFAULT_PARAMS = {
  shapeCount: 60,
  minSize: 10,
  maxSize: 120,
  strokeWidth: 2,
  opacity: 0.85,
  rotationRandom: 0.7,
  scaleRandom: 0.5,
  colorRandom: 0.6,
  noiseAmount: 0.3,
  depthAmount: 0.7,
  density: 0.6,
  complexity: 0.6,
  randomness: 0.5,
  background: '#1a1a2e',
  animType: 'fadeIn'
};

// ─── Composition Grid ─────────────────────────────────────────────────────────

/**
 * Divides the canvas into a grid for balanced placement.
 */
class CompositionGrid {
  /**
   * @param {number} w @param {number} h @param {number} cols @param {number} rows
   */
  constructor(w, h, cols, rows) {
    this.w = w;
    this.h = h;
    this.cols = cols;
    this.rows = rows;
    this.cellW = w / cols;
    this.cellH = h / rows;
    /** @type {number[][]} Occupancy counter per cell */
    this._grid = Array.from({ length: rows }, () => new Array(cols).fill(0));
  }

  /**
   * Return a balanced position, preferring less-occupied cells
   * @param {number} jitter - 0..1 jitter within cell
   * @returns {{ x: number, y: number }}
   */
  balancedPosition(jitter = 0.5) {
    // Find least occupied cells
    let minOcc = Infinity;
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        if (this._grid[r][c] < minOcc) minOcc = this._grid[r][c];
      }
    }
    const candidates = [];
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        if (this._grid[r][c] <= minOcc + 1) candidates.push([c, r]);
      }
    }
    const [cc, cr] = candidates[Math.floor(Math.random() * candidates.length)];
    this._grid[cr][cc]++;

    const x = (cc + 0.5 + (Math.random() - 0.5) * jitter) * this.cellW;
    const y = (cr + 0.5 + (Math.random() - 0.5) * jitter) * this.cellH;
    return { x, y };
  }

  /**
   * Return a random position anywhere in the canvas
   */
  randomPosition(margin = 0) {
    return {
      x: rnd(margin, this.w - margin),
      y: rnd(margin, this.h - margin)
    };
  }
}

// ─── Composition Generator ────────────────────────────────────────────────────

/**
 * Generates a complete abstract composition as an array of Shape instances.
 */
class CompositionGenerator {
  /**
   * @param {import('./palette.js').PaletteManager} palette
   */
  constructor(palette) {
    this._palette = palette;
  }

  /**
   * Generate a new composition
   * @param {number} canvasW - Logical canvas width
   * @param {number} canvasH - Logical canvas height
   * @param {Partial<CompositionParams>} params
   * @returns {import('./geometry.js').Shape[]}
   */
  generate(canvasW, canvasH, params = {}) {
    const p = { ...DEFAULT_PARAMS, ...params };
    const shapes = [];

    const grid = new CompositionGrid(canvasW, canvasH, 6, 4);
    const bg = p.background || this._palette.randomBackground();

    // Determine shape counts per layer
    const bgCount = Math.floor(p.shapeCount * 0.3);
    const midCount = Math.floor(p.shapeCount * 0.45);
    const fgCount = p.shapeCount - bgCount - midCount;

    // ── Background layer ──────────────────────────────────────────────────────
    // Large shapes, low opacity, subtle colors
    this._generateLayer(shapes, grid, {
      count: bgCount,
      depth: 0,
      sizeMin: p.maxSize * 0.5,
      sizeMax: p.maxSize * 1.8,
      opacityMin: 0.15,
      opacityMax: 0.45,
      strokeProb: 0.2,
      useGrid: true,
      jitter: 0.8,
      canvasW, canvasH,
      params: p,
      blendModes: ['source-over', 'multiply', 'screen'],
      shapeTypes: ['circle', 'ring', 'rect', 'arc']
    });

    // ── Mid layer ─────────────────────────────────────────────────────────────
    this._generateLayer(shapes, grid, {
      count: midCount,
      depth: 0.5,
      sizeMin: p.minSize * 2,
      sizeMax: p.maxSize * 0.9,
      opacityMin: 0.5,
      opacityMax: 0.9,
      strokeProb: 0.4,
      useGrid: true,
      jitter: 0.6,
      canvasW, canvasH,
      params: p,
      blendModes: ['source-over', 'overlay'],
      shapeTypes: ['circle', 'triangle', 'polygon', 'arc', 'starburst', 'ring', 'rect']
    });

    // ── Foreground layer ──────────────────────────────────────────────────────
    // Small sharp shapes, high opacity, vivid
    this._generateLayer(shapes, grid, {
      count: fgCount,
      depth: 1,
      sizeMin: p.minSize,
      sizeMax: p.maxSize * 0.45,
      opacityMin: 0.7,
      opacityMax: 1.0,
      strokeProb: 0.5,
      useGrid: false,
      jitter: 1.0,
      canvasW, canvasH,
      params: p,
      blendModes: ['source-over'],
      shapeTypes: ['circle', 'dot', 'triangle', 'polygon', 'starburst', 'ring']
    });

    // ── Lines and curves (depth-agnostic) ─────────────────────────────────────
    const lineCount = Math.floor(p.shapeCount * 0.2 * p.complexity);
    this._generateLines(shapes, canvasW, canvasH, p, lineCount);

    // Sort by depth for correct draw order (back to front)
    shapes.sort((a, b) => a.depth - b.depth);

    return shapes;
  }

  /**
   * Generate shapes for one depth layer
   * @private
   */
  _generateLayer(shapes, grid, opts) {
    const { count, depth, sizeMin, sizeMax, opacityMin, opacityMax,
      strokeProb, useGrid, jitter, canvasW, canvasH, params, blendModes, shapeTypes } = opts;

    for (let i = 0; i < count; i++) {
      const pos = useGrid
        ? grid.balancedPosition(jitter)
        : grid.randomPosition(sizeMin * 0.5);

      const size = rnd(sizeMin, sizeMax) * (1 + (Math.random() - 0.5) * params.scaleRandom);
      const opacity = rnd(opacityMin, opacityMax) * params.opacity;
      const rotation = params.rotationRandom > 0
        ? rnd(-Math.PI, Math.PI) * params.rotationRandom
        : 0;

      const color = this._palette.randomColor();
      const useStroke = Math.random() < strokeProb;
      const strokeColor = useStroke ? this._palette.randomColor() : null;
      const sw = useStroke ? rnd(1, params.strokeWidth * 4) : 0;
      const blendMode = blendModes[Math.floor(Math.random() * blendModes.length)];

      const shapeType = shapeTypes[Math.floor(Math.random() * shapeTypes.length)];
      const animDelay = depth * 0.2 + i * 0.02;
      const animDuration = rnd(0.4, 1.2);

      const base = {
        x: pos.x, y: pos.y,
        color: hexToRgba(color, opacity),
        strokeColor: strokeColor ? hexToRgba(strokeColor, Math.min(1, opacity + 0.2)) : null,
        strokeWidth: sw,
        opacity: 1, // already baked into color
        rotation,
        depth: depth + Math.random() * 0.1,
        blendMode,
        animType: params.animType,
        animDelay,
        animDuration
      };

      let shape;
      switch (shapeType) {
        case 'circle':
          shape = new CircleShape({ ...base, radius: size / 2, fill: Math.random() > 0.3 });
          break;
        case 'ring': {
          const outerR = size / 2;
          const innerR = outerR * rnd(0.3, 0.75);
          shape = new RingShape({ ...base, radius: outerR, innerRadius: innerR });
          break;
        }
        case 'arc': {
          const startA = rnd(0, Math.PI * 2);
          const sweep = rnd(Math.PI * 0.3, Math.PI * 1.8);
          shape = new ArcShape({
            ...base, radius: size / 2,
            startAngle: startA, endAngle: startA + sweep,
            width: rnd(2, params.strokeWidth * 6),
            fill: Math.random() > 0.6
          });
          break;
        }
        case 'triangle':
          shape = new TriangleShape({ ...base, size, fill: Math.random() > 0.25 });
          break;
        case 'rect': {
          const aspect = rnd(0.4, 2.5);
          shape = new RectShape({
            ...base, w: size, h: size * aspect, fill: Math.random() > 0.3
          });
          break;
        }
        case 'polygon':
          shape = new PolygonShape({
            ...base, radius: size / 2,
            sides: rndInt(3, 8),
            fill: Math.random() > 0.3
          });
          break;
        case 'dot':
          shape = new DotShape({ ...base, radius: Math.max(2, size * 0.1) });
          break;
        case 'starburst':
          shape = new StarburstShape({
            ...base, outerRadius: size / 2,
            innerRadius: size / 4,
            points: rndInt(4, 8)
          });
          break;
        default:
          shape = new CircleShape({ ...base, radius: size / 2 });
      }

      shapes.push(shape);
    }
  }

  /**
   * Generate line/curve/spline shapes
   * @private
   */
  _generateLines(shapes, canvasW, canvasH, params, count) {
    const lineTypes = ['line', 'curve', 'spline', 'line', 'line'];

    for (let i = 0; i < count; i++) {
      const x1 = rnd(0, canvasW);
      const y1 = rnd(0, canvasH);
      const color = this._palette.randomColor();
      const opacity = rnd(0.4, 0.9) * params.opacity;
      const depth = Math.random();
      const animDelay = i * 0.03;
      const animDuration = rnd(0.3, 0.8);
      const ltype = lineTypes[Math.floor(Math.random() * lineTypes.length)];

      const base = {
        x: x1, y: y1,
        color: hexToRgba(color, opacity),
        opacity: 1,
        depth,
        blendMode: 'source-over',
        animType: params.animType,
        animDelay,
        animDuration
      };

      if (ltype === 'line') {
        const len = rnd(20, Math.max(canvasW, canvasH) * 0.6);
        const angle = rnd(0, Math.PI * 2);
        shapes.push(new LineShape({
          ...base,
          x2: x1 + Math.cos(angle) * len,
          y2: y1 + Math.sin(angle) * len,
          width: rnd(1, params.strokeWidth * 5),
          cap: 'round'
        }));
      } else if (ltype === 'curve') {
        const len = rnd(50, canvasW * 0.5);
        const angle = rnd(0, Math.PI * 2);
        const cx = x1 + rnd(-len, len);
        const cy = y1 + rnd(-len, len);
        shapes.push(new CurveShape({
          ...base,
          x2: x1 + Math.cos(angle) * len,
          y2: y1 + Math.sin(angle) * len,
          cx, cy,
          width: rnd(1, params.strokeWidth * 4)
        }));
      } else if (ltype === 'spline') {
        const nPts = rndInt(4, 8);
        const points = [{ x: x1, y: y1 }];
        for (let j = 1; j < nPts; j++) {
          points.push({
            x: rnd(0, canvasW),
            y: rnd(0, canvasH)
          });
        }
        shapes.push(new SplineShape({
          ...base,
          points,
          width: rnd(1, params.strokeWidth * 3)
        }));
      }
    }
  }
}

// ─── Canvas Renderer ──────────────────────────────────────────────────────────

/**
 * Manages the HTML5 Canvas, DPR scaling, and shape rendering.
 */
class CanvasRenderer {
  /**
   * @param {HTMLCanvasElement} canvas
   */
  constructor(canvas) {
    this._canvas = canvas;
    this._ctx = canvas.getContext('2d', { alpha: false });
    this._dpr = window.devicePixelRatio || 1;
    this._logicalW = 0;
    this._logicalH = 0;
    this._background = '#1a1a2e';
    this._backgroundImage = null;
    this._backgroundImageObj = null;
    this._effects = { ...DEFAULT_EFFECTS };

    // Transform state for pan/zoom
    this._panX = 0;
    this._panY = 0;
    this._zoom = 1;

    this.resize();
  }

  /** Update canvas size to match its CSS size */
  resize() {
    const dpr = window.devicePixelRatio || 1;
    this._dpr = dpr;
    const w = this._canvas.clientWidth;
    const h = this._canvas.clientHeight;
    this._logicalW = w;
    this._logicalH = h;
    this._canvas.width = Math.round(w * dpr);
    this._canvas.height = Math.round(h * dpr);
  }

  /** @returns {number} Logical width */
  get width() { return this._logicalW; }

  /** @returns {number} Logical height */
  get height() { return this._logicalH; }

  /** @param {string} color */
  setBackground(color) {
    this._background = color;
  }

  /** @param {string|null} dataUrl */
  setBackgroundImage(dataUrl) {
    this._backgroundImage = dataUrl || null;
    this._backgroundImageObj = null;
    if (this._backgroundImage) {
      const img = new Image();
      img.decoding = 'async';
      img.src = this._backgroundImage;
      this._backgroundImageObj = img;
    }
  }

  /** @param {Record<string, number>} effects */
  setEffects(effects) {
    this._effects = { ...DEFAULT_EFFECTS, ...(effects || {}) };
  }

  /** @param {number} x @param {number} y */
  setPan(x, y) {
    this._panX = x;
    this._panY = y;
  }

  /** @param {number} zoom */
  setZoom(zoom) {
    this._zoom = clamp(zoom, 0.2, 5);
  }

  /** Reset pan and zoom */
  resetTransform() {
    this._panX = 0;
    this._panY = 0;
    this._zoom = 1;
  }

  /**
   * Render the current frame
   * @param {import('./geometry.js').Shape[]} shapes
   * @param {number} [overlayAlpha=0] - Transition overlay
   */
  render(shapes, overlayAlpha = 0) {
    const ctx = this._ctx;
    const dpr = this._dpr;
    const w = this._logicalW;
    const h = this._logicalH;

    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const filter = buildCanvasFilter(this._effects);
    ctx.filter = filter;

    if (this._backgroundImageObj && this._backgroundImageObj.complete) {
      const img = this._backgroundImageObj;
      const scale = Math.max(w / img.width, h / img.height);
      const renderW = img.width * scale;
      const renderH = img.height * scale;
      const x = (w - renderW) / 2;
      const y = (h - renderH) / 2;
      ctx.drawImage(img, x, y, renderW, renderH);
    } else {
      ctx.fillStyle = this._background;
      ctx.fillRect(0, 0, w, h);
    }

    ctx.translate(w / 2 + this._panX, h / 2 + this._panY);
    ctx.scale(this._zoom, this._zoom);
    ctx.translate(-w / 2, -h / 2);

    for (const shape of shapes) {
      if (shape.animProgress <= 0 && shape.animDelay > 0) continue;
      shape.draw(ctx);
    }

    ctx.restore();

    if (this._effects.vignette > 0) {
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const vignette = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.2, w / 2, h / 2, Math.max(w, h) * 0.8);
      vignette.addColorStop(0, `rgba(0, 0, 0, 0)`);
      vignette.addColorStop(1, `rgba(25, 18, 40, ${this._effects.vignette})`);
      ctx.fillStyle = vignette;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }

    if (this._effects.grain > 0) {
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const grainCanvas = document.createElement('canvas');
      grainCanvas.width = w;
      grainCanvas.height = h;
      const g = grainCanvas.getContext('2d');
      const img = g.createImageData(w, h);
      for (let i = 0; i < img.data.length; i += 4) {
        const noise = (Math.random() - 0.5) * 255 * this._effects.grain;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = 255 + noise;
        img.data[i + 3] = 30;
      }
      g.putImageData(img, 0, 0);
      ctx.globalAlpha = 0.18;
      ctx.drawImage(grainCanvas, 0, 0, w, h);
      ctx.restore();
    }

    if (overlayAlpha > 0) {
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = `rgba(0,0,0,${overlayAlpha.toFixed(3)})`;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }
  }

  /**
   * Render to an offscreen canvas at full quality for export
   * @param {import('./geometry.js').Shape[]} shapes
   * @param {string} background
   * @param {number} [scale=1]
   * @returns {HTMLCanvasElement}
   */
  renderToOffscreen(shapes, background, scale = 1) {
    const oc = document.createElement('canvas');
    oc.width = this._logicalW * scale;
    oc.height = this._logicalH * scale;
    const octx = oc.getContext('2d', { alpha: false });

    octx.save();
    octx.scale(scale, scale);

    if (this._backgroundImageObj && this._backgroundImageObj.complete) {
      const img = this._backgroundImageObj;
      const w = this._logicalW;
      const h = this._logicalH;
      const renderScale = Math.max(w / img.width, h / img.height);
      const renderW = img.width * renderScale;
      const renderH = img.height * renderScale;
      const x = (w - renderW) / 2;
      const y = (h - renderH) / 2;
      octx.drawImage(img, x, y, renderW, renderH);
    } else {
      octx.fillStyle = background;
      octx.fillRect(0, 0, this._logicalW, this._logicalH);
    }

    const saved = shapes.map(s => s.animProgress);
    shapes.forEach(s => { s.animProgress = 1; });

    for (const shape of shapes) {
      shape.draw(octx);
    }

    shapes.forEach((s, i) => { s.animProgress = saved[i]; });

    octx.restore();
    return oc;
  }

  /** @returns {HTMLCanvasElement} */
  get canvas() { return this._canvas; }

  /** @returns {CanvasRenderingContext2D} */
  get ctx() { return this._ctx; }
}

export { CompositionGenerator, CompositionGrid, CanvasRenderer, DEFAULT_PARAMS };
