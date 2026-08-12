/**
 * animation.js
 * Manages the animation loop and per-shape animation state for Abstract Painter.
 */

'use strict';

import { clamp, easeInOut } from './geometry.js';

/**
 * AnimationController manages the RAF loop and drives shape animations.
 */
class AnimationController {
  /**
   * @param {object} opts
   * @param {Function} opts.onFrame - Called each frame with (dt, timestamp)
   */
  constructor(opts = {}) {
    this._onFrame = opts.onFrame || (() => {});
    this._running = false;
    this._rafId = null;
    this._lastTime = 0;
    this._speed = 1.0;         // Animation speed multiplier
    this._continuousMotion = false;
    this._paused = false;

    // Stats
    this.fps = 0;
    this._fpsAccum = 0;
    this._fpsCount = 0;
    this._fpsTimer = 0;
  }

  /** @param {number} speed 0..2 */
  setSpeed(speed) {
    this._speed = clamp(speed, 0, 2);
  }

  /** @param {boolean} enabled */
  setContinuousMotion(enabled) {
    this._continuousMotion = enabled;
  }

  /** @returns {boolean} */
  isContinuousMotion() {
    return this._continuousMotion;
  }

  /** Start the animation loop */
  start() {
    if (this._running) return;
    this._running = true;
    this._paused = false;
    this._lastTime = performance.now();
    this._tick(this._lastTime);
  }

  /** Stop the animation loop */
  stop() {
    this._running = false;
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
  }

  /** Pause without cancelling */
  pause() {
    this._paused = true;
  }

  /** Resume from pause */
  resume() {
    if (this._paused) {
      this._paused = false;
      this._lastTime = performance.now();
    }
  }

  /** @private */
  _tick(timestamp) {
    if (!this._running) return;
    this._rafId = requestAnimationFrame((ts) => this._tick(ts));

    if (this._paused) return;

    const rawDt = (timestamp - this._lastTime) / 1000;
    this._lastTime = timestamp;

    // Cap dt to avoid spiral of death on tab switch
    const dt = Math.min(rawDt, 0.1) * this._speed;

    // FPS tracking
    this._fpsAccum += rawDt;
    this._fpsCount++;
    this._fpsTimer += rawDt;
    if (this._fpsTimer >= 0.5) {
      this.fps = Math.round(this._fpsCount / this._fpsAccum);
      this._fpsAccum = 0;
      this._fpsCount = 0;
      this._fpsTimer = 0;
    }

    this._onFrame(dt, timestamp);
  }

  /** @returns {boolean} */
  isRunning() {
    return this._running;
  }
}

/**
 * ShapeAnimator applies per-shape intro animation and optional drift motion.
 */
class ShapeAnimator {
  /**
   * @param {object} opts
   * @param {number} [opts.staggerDelay=0.05] - Seconds between each shape appearing
   * @param {boolean} [opts.continuousMotion=false]
   */
  constructor(opts = {}) {
    this._staggerDelay = opts.staggerDelay !== undefined ? opts.staggerDelay : 0.05;
    this._continuousMotion = opts.continuousMotion || false;
    this._elapsed = 0;
    this._shapes = [];
  }

  /** @param {import('./geometry.js').Shape[]} shapes */
  setShapes(shapes) {
    this._shapes = shapes;
    this._elapsed = 0;
    // Assign staggered delays based on depth (background first)
    const sorted = [...shapes].sort((a, b) => a.depth - b.depth);
    sorted.forEach((s, i) => {
      s.animProgress = 0;
      s.animDelay = i * this._staggerDelay;
    });
  }

  /** @param {boolean} v */
  setContinuousMotion(v) {
    this._continuousMotion = v;
  }

  /**
   * Update all shapes
   * @param {number} dt - seconds
   */
  update(dt) {
    this._elapsed += dt;

    for (const shape of this._shapes) {
      // Intro animation
      const effectiveTime = this._elapsed - shape.animDelay;
      if (effectiveTime > 0 && shape.animProgress < 1) {
        shape.animProgress = clamp(effectiveTime / shape.animDuration, 0, 1);
      }

      // Continuous drift motion
      if (this._continuousMotion && shape.animProgress >= 1) {
        shape.driftX += shape._driftVX * dt;
        shape.driftY += shape._driftVY * dt;
        shape.driftRot += shape._driftVRot * dt;

        // Gentle oscillation
        if (shape._driftOscX !== undefined) {
          shape.driftX = Math.sin(this._elapsed * shape._driftOscX) * shape._driftAmpX;
          shape.driftY = Math.cos(this._elapsed * shape._driftOscY) * shape._driftAmpY;
        }
      }
    }
  }

  /**
   * Assign random drift velocities to each shape for continuous motion
   * @param {import('./geometry.js').Shape[]} shapes
   */
  static assignDrift(shapes) {
    for (const shape of shapes) {
      // Use oscillation-based drift for smooth looping
      const speed = 0.1 + Math.random() * 0.3;
      shape._driftOscX = speed * (0.5 + Math.random() * 0.5);
      shape._driftOscY = speed * (0.5 + Math.random() * 0.5);
      shape._driftAmpX = 2 + Math.random() * 8;
      shape._driftAmpY = 2 + Math.random() * 8;
      shape._driftVRot = (Math.random() - 0.5) * 0.002;
      // Init to 0
      shape._driftVX = 0;
      shape._driftVY = 0;
    }
  }

  /** @returns {boolean} All shapes fully visible */
  isComplete() {
    return this._shapes.every(s => s.animProgress >= 1);
  }

  /** Skip intro, show all shapes fully */
  skipIntro() {
    for (const shape of this._shapes) {
      shape.animProgress = 1;
    }
  }
}

/**
 * Transition helper - fades canvas between compositions
 */
class CanvasTransition {
  constructor() {
    this._active = false;
    this._progress = 0;
    this._duration = 0.4;
    this._onComplete = null;
  }

  /**
   * Start a fade-out-then-callback transition
   * @param {Function} onComplete - Called at midpoint
   * @param {number} [duration=0.4]
   */
  start(onComplete, duration = 0.4) {
    this._active = true;
    this._progress = 0;
    this._duration = duration;
    this._onComplete = onComplete;
    this._midFired = false;
  }

  /** @param {number} dt */
  update(dt) {
    if (!this._active) return;
    this._progress = Math.min(1, this._progress + dt / this._duration);
    if (!this._midFired && this._progress >= 0.5) {
      this._midFired = true;
      if (this._onComplete) this._onComplete();
    }
    if (this._progress >= 1) {
      this._active = false;
    }
  }

  /** @returns {number} Overlay alpha 0..1 (peaks at 0.5, returns to 0) */
  getOverlayAlpha() {
    if (!this._active) return 0;
    // Triangle wave: 0→1 at t=0.5, 1→0 at t=1
    return this._progress < 0.5
      ? easeInOut(this._progress * 2)
      : easeInOut((1 - this._progress) * 2);
  }

  /** @returns {boolean} */
  isActive() {
    return this._active;
  }
}

export { AnimationController, ShapeAnimator, CanvasTransition };
