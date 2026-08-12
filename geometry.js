/**
 * geometry.js
 * Shape generation and math utilities for Abstract Painter.
 * Provides classes for every shape type used in compositions.
 */

'use strict';

// ─── Math Helpers ────────────────────────────────────────────────────────────

/**
 * Random float in [min, max]
 * @param {number} min @param {number} max @returns {number}
 */
function rnd(min, max) {
  return min + Math.random() * (max - min);
}

/**
 * Random integer in [min, max]
 * @param {number} min @param {number} max @returns {number}
 */
function rndInt(min, max) {
  return Math.floor(rnd(min, max + 1));
}

/**
 * Clamp value between min and max
 */
function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

/**
 * Linear interpolation
 */
function lerp(a, b, t) {
  return a + (b - a) * t;
}

/**
 * Easing: ease-out cubic
 */
function easeOut(t) {
  return 1 - Math.pow(1 - t, 3);
}

/**
 * Easing: ease-in-out sine
 */
function easeInOut(t) {
  return -(Math.cos(Math.PI * t) - 1) / 2;
}

/**
 * Rotate point (px, py) around origin (ox, oy) by angle radians
 * @returns {[number, number]}
 */
function rotatePoint(px, py, ox, oy, angle) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dx = px - ox;
  const dy = py - oy;
  return [ox + dx * cos - dy * sin, oy + dx * sin + dy * cos];
}

/**
 * Compute a catmull-rom spline point
 */
function catmullRom(t, p0, p1, p2, p3) {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (
    (2 * p1) +
    (-p0 + p2) * t +
    (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
    (-p0 + 3 * p1 - 3 * p2 + p3) * t3
  );
}

// ─── Base Shape ───────────────────────────────────────────────────────────────

/**
 * Base class for all shapes.
 * @abstract
 */
class Shape {
  /**
   * @param {object} opts
   * @param {number} opts.x
   * @param {number} opts.y
   * @param {string} opts.color
   * @param {string} [opts.strokeColor]
   * @param {number} [opts.strokeWidth=0]
   * @param {number} [opts.opacity=1]
   * @param {number} [opts.rotation=0]
   * @param {number} [opts.depth=0] - 0=background, 1=foreground
   * @param {string} [opts.blendMode='source-over']
   */
  constructor(opts) {
    this.x = opts.x;
    this.y = opts.y;
    this.color = opts.color;
    this.strokeColor = opts.strokeColor || null;
    this.strokeWidth = opts.strokeWidth || 0;
    this.opacity = opts.opacity !== undefined ? opts.opacity : 1;
    this.rotation = opts.rotation || 0;
    this.depth = opts.depth !== undefined ? opts.depth : 0;
    this.blendMode = opts.blendMode || 'source-over';
    /** Animation state */
    this.animProgress = 0; // 0..1
    this.animType = opts.animType || 'fadeIn'; // fadeIn | scaleIn | rotateIn | none
    this.animDelay = opts.animDelay || 0;
    this.animDuration = opts.animDuration || 1.0;
    /** Continuous motion */
    this.driftX = opts.driftX || 0;
    this.driftY = opts.driftY || 0;
    this.driftRot = opts.driftRot || 0;
    this._type = 'shape';
  }

  /** @returns {string} Shape type identifier */
  get type() { return this._type; }

  /**
   * Draw the shape on the given context.
   * @param {CanvasRenderingContext2D} ctx
   */
  draw(ctx) {
    throw new Error('Shape.draw() must be implemented');
  }

  /**
   * Advance animation progress
   * @param {number} dt - Delta time in seconds
   */
  updateAnimation(dt) {
    if (this.animProgress < 1) {
      this.animProgress = Math.min(1, this.animProgress + dt / this.animDuration);
    }
  }

  /**
   * Get current animated opacity
   * @returns {number}
   */
  getAnimatedOpacity() {
    if (this.animType === 'none') return this.opacity;
    const t = easeOut(this.animProgress);
    if (this.animType === 'fadeIn' || this.animType === 'scaleIn') {
      return this.opacity * t;
    }
    return this.opacity * t;
  }

  /**
   * Get current animated scale
   * @returns {number}
   */
  getAnimatedScale() {
    if (this.animType === 'scaleIn') {
      return easeOut(this.animProgress);
    }
    return 1;
  }

  /**
   * Apply saved context state for drawing
   * @param {CanvasRenderingContext2D} ctx
   * @param {Function} drawFn
   */
  withContext(ctx, drawFn) {
    ctx.save();
    ctx.globalAlpha = clamp(this.getAnimatedOpacity(), 0, 1);
    ctx.globalCompositeOperation = this.blendMode;
    ctx.translate(this.x + this.driftX, this.y + this.driftY);
    ctx.rotate(this.rotation + this.driftRot);

    const scale = this.getAnimatedScale();
    if (scale !== 1) ctx.scale(scale, scale);

    drawFn(ctx);
    ctx.restore();
  }

  /** Serialise to plain object for storage */
  toJSON() {
    return {
      type: this._type,
      x: this.x, y: this.y,
      color: this.color,
      strokeColor: this.strokeColor,
      strokeWidth: this.strokeWidth,
      opacity: this.opacity,
      rotation: this.rotation,
      depth: this.depth,
      blendMode: this.blendMode,
      animType: this.animType,
      animDelay: this.animDelay,
      animDuration: this.animDuration
    };
  }
}

// ─── Circle ───────────────────────────────────────────────────────────────────

class CircleShape extends Shape {
  /**
   * @param {object} opts
   * @param {number} opts.radius
   * @param {boolean} [opts.fill=true]
   */
  constructor(opts) {
    super(opts);
    this._type = 'circle';
    this.radius = opts.radius;
    this.fill = opts.fill !== undefined ? opts.fill : true;
  }

  draw(ctx) {
    this.withContext(ctx, (c) => {
      c.beginPath();
      c.arc(0, 0, this.radius, 0, Math.PI * 2);
      if (this.fill) {
        c.fillStyle = this.color;
        c.fill();
      }
      if (this.strokeColor && this.strokeWidth > 0) {
        c.strokeStyle = this.strokeColor;
        c.lineWidth = this.strokeWidth;
        c.stroke();
      }
    });
  }

  toJSON() {
    return { ...super.toJSON(), radius: this.radius, fill: this.fill };
  }
}

// ─── Ring (hollow circle) ─────────────────────────────────────────────────────

class RingShape extends Shape {
  /**
   * @param {object} opts
   * @param {number} opts.radius
   * @param {number} opts.innerRadius
   */
  constructor(opts) {
    super(opts);
    this._type = 'ring';
    this.radius = opts.radius;
    this.innerRadius = opts.innerRadius;
  }

  draw(ctx) {
    this.withContext(ctx, (c) => {
      c.beginPath();
      c.arc(0, 0, this.radius, 0, Math.PI * 2);
      c.arc(0, 0, this.innerRadius, 0, Math.PI * 2, true);
      c.fillStyle = this.color;
      c.fill('evenodd');
      if (this.strokeColor && this.strokeWidth > 0) {
        c.beginPath();
        c.arc(0, 0, this.radius, 0, Math.PI * 2);
        c.strokeStyle = this.strokeColor;
        c.lineWidth = this.strokeWidth;
        c.stroke();
        c.beginPath();
        c.arc(0, 0, this.innerRadius, 0, Math.PI * 2);
        c.stroke();
      }
    });
  }

  toJSON() {
    return { ...super.toJSON(), radius: this.radius, innerRadius: this.innerRadius };
  }
}

// ─── Line ─────────────────────────────────────────────────────────────────────

class LineShape extends Shape {
  /**
   * @param {object} opts
   * @param {number} opts.x2
   * @param {number} opts.y2
   * @param {number} opts.width
   * @param {string} [opts.cap='butt'] - 'butt'|'round'|'square'
   */
  constructor(opts) {
    super(opts);
    this._type = 'line';
    this.x2 = opts.x2;
    this.y2 = opts.y2;
    this.width = opts.width;
    this.cap = opts.cap || 'round';
  }

  draw(ctx) {
    ctx.save();
    ctx.globalAlpha = clamp(this.getAnimatedOpacity(), 0, 1);
    ctx.globalCompositeOperation = this.blendMode;
    ctx.beginPath();
    ctx.moveTo(this.x + this.driftX, this.y + this.driftY);
    ctx.lineTo(this.x2 + this.driftX, this.y2 + this.driftY);
    ctx.strokeStyle = this.color;
    ctx.lineWidth = this.width;
    ctx.lineCap = this.cap;
    ctx.stroke();
    ctx.restore();
  }

  toJSON() {
    return { ...super.toJSON(), x2: this.x2, y2: this.y2, width: this.width, cap: this.cap };
  }
}

// ─── Arc ──────────────────────────────────────────────────────────────────────

class ArcShape extends Shape {
  /**
   * @param {object} opts
   * @param {number} opts.radius
   * @param {number} opts.startAngle
   * @param {number} opts.endAngle
   * @param {number} opts.width
   * @param {boolean} [opts.fill=false]
   */
  constructor(opts) {
    super(opts);
    this._type = 'arc';
    this.radius = opts.radius;
    this.startAngle = opts.startAngle;
    this.endAngle = opts.endAngle;
    this.width = opts.width;
    this.fill = opts.fill || false;
  }

  draw(ctx) {
    this.withContext(ctx, (c) => {
      c.beginPath();
      c.arc(0, 0, this.radius, this.startAngle, this.endAngle);
      if (this.fill) {
        c.lineTo(0, 0);
        c.fillStyle = this.color;
        c.fill();
      } else {
        c.strokeStyle = this.color;
        c.lineWidth = this.width;
        c.lineCap = 'round';
        c.stroke();
      }
    });
  }

  toJSON() {
    return {
      ...super.toJSON(),
      radius: this.radius, startAngle: this.startAngle,
      endAngle: this.endAngle, width: this.width, fill: this.fill
    };
  }
}

// ─── Triangle ─────────────────────────────────────────────────────────────────

class TriangleShape extends Shape {
  /**
   * @param {object} opts
   * @param {number} opts.size - Side length
   * @param {boolean} [opts.fill=true]
   */
  constructor(opts) {
    super(opts);
    this._type = 'triangle';
    this.size = opts.size;
    this.fill = opts.fill !== undefined ? opts.fill : true;
  }

  draw(ctx) {
    this.withContext(ctx, (c) => {
      const h = this.size * Math.sqrt(3) / 2;
      c.beginPath();
      c.moveTo(0, -h * 2 / 3);
      c.lineTo(this.size / 2, h / 3);
      c.lineTo(-this.size / 2, h / 3);
      c.closePath();
      if (this.fill) {
        c.fillStyle = this.color;
        c.fill();
      }
      if (this.strokeColor && this.strokeWidth > 0) {
        c.strokeStyle = this.strokeColor;
        c.lineWidth = this.strokeWidth;
        c.stroke();
      }
    });
  }

  toJSON() {
    return { ...super.toJSON(), size: this.size, fill: this.fill };
  }
}

// ─── Rectangle / Square ───────────────────────────────────────────────────────

class RectShape extends Shape {
  /**
   * @param {object} opts
   * @param {number} opts.w
   * @param {number} opts.h
   * @param {boolean} [opts.fill=true]
   */
  constructor(opts) {
    super(opts);
    this._type = 'rect';
    this.w = opts.w;
    this.h = opts.h;
    this.fill = opts.fill !== undefined ? opts.fill : true;
  }

  draw(ctx) {
    this.withContext(ctx, (c) => {
      c.beginPath();
      c.rect(-this.w / 2, -this.h / 2, this.w, this.h);
      if (this.fill) {
        c.fillStyle = this.color;
        c.fill();
      }
      if (this.strokeColor && this.strokeWidth > 0) {
        c.strokeStyle = this.strokeColor;
        c.lineWidth = this.strokeWidth;
        c.stroke();
      }
    });
  }

  toJSON() {
    return { ...super.toJSON(), w: this.w, h: this.h, fill: this.fill };
  }
}

// ─── Polygon ──────────────────────────────────────────────────────────────────

class PolygonShape extends Shape {
  /**
   * @param {object} opts
   * @param {number} opts.radius
   * @param {number} opts.sides - Number of sides (3..12)
   * @param {boolean} [opts.fill=true]
   */
  constructor(opts) {
    super(opts);
    this._type = 'polygon';
    this.radius = opts.radius;
    this.sides = Math.max(3, Math.min(12, opts.sides));
    this.fill = opts.fill !== undefined ? opts.fill : true;
  }

  draw(ctx) {
    this.withContext(ctx, (c) => {
      c.beginPath();
      for (let i = 0; i < this.sides; i++) {
        const angle = (i / this.sides) * Math.PI * 2 - Math.PI / 2;
        const px = Math.cos(angle) * this.radius;
        const py = Math.sin(angle) * this.radius;
        if (i === 0) c.moveTo(px, py);
        else c.lineTo(px, py);
      }
      c.closePath();
      if (this.fill) {
        c.fillStyle = this.color;
        c.fill();
      }
      if (this.strokeColor && this.strokeWidth > 0) {
        c.strokeStyle = this.strokeColor;
        c.lineWidth = this.strokeWidth;
        c.stroke();
      }
    });
  }

  toJSON() {
    return { ...super.toJSON(), radius: this.radius, sides: this.sides, fill: this.fill };
  }
}

// ─── Dot ──────────────────────────────────────────────────────────────────────

class DotShape extends Shape {
  /**
   * @param {object} opts
   * @param {number} opts.radius
   */
  constructor(opts) {
    super(opts);
    this._type = 'dot';
    this.radius = opts.radius;
  }

  draw(ctx) {
    this.withContext(ctx, (c) => {
      c.beginPath();
      c.arc(0, 0, this.radius, 0, Math.PI * 2);
      c.fillStyle = this.color;
      c.fill();
    });
  }

  toJSON() {
    return { ...super.toJSON(), radius: this.radius };
  }
}

// ─── Curve (quadratic bezier) ─────────────────────────────────────────────────

class CurveShape extends Shape {
  /**
   * @param {object} opts
   * @param {number} opts.x2 - End x
   * @param {number} opts.y2 - End y
   * @param {number} opts.cx - Control point x
   * @param {number} opts.cy - Control point y
   * @param {number} opts.width
   */
  constructor(opts) {
    super(opts);
    this._type = 'curve';
    this.x2 = opts.x2;
    this.y2 = opts.y2;
    this.cx = opts.cx;
    this.cy = opts.cy;
    this.width = opts.width;
  }

  draw(ctx) {
    ctx.save();
    ctx.globalAlpha = clamp(this.getAnimatedOpacity(), 0, 1);
    ctx.globalCompositeOperation = this.blendMode;
    ctx.beginPath();
    ctx.moveTo(this.x + this.driftX, this.y + this.driftY);
    ctx.quadraticCurveTo(
      this.cx + this.driftX, this.cy + this.driftY,
      this.x2 + this.driftX, this.y2 + this.driftY
    );
    ctx.strokeStyle = this.color;
    ctx.lineWidth = this.width;
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.restore();
  }

  toJSON() {
    return {
      ...super.toJSON(),
      x2: this.x2, y2: this.y2,
      cx: this.cx, cy: this.cy, width: this.width
    };
  }
}

// ─── Spline (catmull-rom through multiple points) ─────────────────────────────

class SplineShape extends Shape {
  /**
   * @param {object} opts
   * @param {Array<{x:number,y:number}>} opts.points - Control points (min 4)
   * @param {number} opts.width
   * @param {number} [opts.tension=0.5]
   */
  constructor(opts) {
    super(opts);
    this._type = 'spline';
    this.points = opts.points;
    this.width = opts.width;
    this.tension = opts.tension !== undefined ? opts.tension : 0.5;
  }

  draw(ctx) {
    if (this.points.length < 2) return;
    ctx.save();
    ctx.globalAlpha = clamp(this.getAnimatedOpacity(), 0, 1);
    ctx.globalCompositeOperation = this.blendMode;

    const pts = this.points;
    const dx = this.driftX;
    const dy = this.driftY;

    ctx.beginPath();
    ctx.moveTo(pts[0].x + dx, pts[0].y + dy);

    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[Math.min(pts.length - 1, i + 2)];

      const steps = 12;
      for (let s = 1; s <= steps; s++) {
        const t = s / steps;
        const bx = catmullRom(t, p0.x, p1.x, p2.x, p3.x);
        const by = catmullRom(t, p0.y, p1.y, p2.y, p3.y);
        ctx.lineTo(bx + dx, by + dy);
      }
    }

    ctx.strokeStyle = this.color;
    ctx.lineWidth = this.width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.restore();
  }

  toJSON() {
    return { ...super.toJSON(), points: this.points, width: this.width, tension: this.tension };
  }
}

// ─── Starburst ────────────────────────────────────────────────────────────────

class StarburstShape extends Shape {
  /**
   * @param {object} opts
   * @param {number} opts.outerRadius
   * @param {number} opts.innerRadius
   * @param {number} opts.points
   */
  constructor(opts) {
    super(opts);
    this._type = 'starburst';
    this.outerRadius = opts.outerRadius;
    this.innerRadius = opts.innerRadius;
    this.points = opts.points || 5;
  }

  draw(ctx) {
    this.withContext(ctx, (c) => {
      c.beginPath();
      for (let i = 0; i < this.points * 2; i++) {
        const angle = (i / (this.points * 2)) * Math.PI * 2 - Math.PI / 2;
        const r = i % 2 === 0 ? this.outerRadius : this.innerRadius;
        const px = Math.cos(angle) * r;
        const py = Math.sin(angle) * r;
        if (i === 0) c.moveTo(px, py);
        else c.lineTo(px, py);
      }
      c.closePath();
      c.fillStyle = this.color;
      c.fill();
      if (this.strokeColor && this.strokeWidth > 0) {
        c.strokeStyle = this.strokeColor;
        c.lineWidth = this.strokeWidth;
        c.stroke();
      }
    });
  }

  toJSON() {
    return {
      ...super.toJSON(),
      outerRadius: this.outerRadius, innerRadius: this.innerRadius, points: this.points
    };
  }
}

// ─── Shape Factory ────────────────────────────────────────────────────────────

/**
 * Reconstruct a Shape from its JSON representation
 * @param {object} data
 * @returns {Shape}
 */
function shapeFromJSON(data) {
  switch (data.type) {
    case 'circle':    return new CircleShape(data);
    case 'ring':      return new RingShape(data);
    case 'line':      return new LineShape(data);
    case 'arc':       return new ArcShape(data);
    case 'triangle':  return new TriangleShape(data);
    case 'rect':      return new RectShape(data);
    case 'polygon':   return new PolygonShape(data);
    case 'dot':       return new DotShape(data);
    case 'curve':     return new CurveShape(data);
    case 'spline':    return new SplineShape(data);
    case 'starburst': return new StarburstShape(data);
    default:          throw new Error(`Unknown shape type: ${data.type}`);
  }
}

export {
  rnd, rndInt, clamp, lerp, easeOut, easeInOut, rotatePoint, catmullRom,
  Shape, CircleShape, RingShape, LineShape, ArcShape,
  TriangleShape, RectShape, PolygonShape, DotShape,
  CurveShape, SplineShape, StarburstShape,
  shapeFromJSON
};
