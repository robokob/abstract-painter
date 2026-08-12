/**
 * storage.js
 * Save, load, and manage paintings in localStorage for Abstract Painter.
 */

'use strict';

const STORAGE_KEY = 'abstractPainter_gallery';
const SETTINGS_KEY = 'abstractPainter_settings';
const MAX_PAINTINGS = 50;

/**
 * @typedef {object} SavedPainting
 * @property {string} id
 * @property {string} name
 * @property {string} thumbnail - Base64 data URL of thumbnail
 * @property {string} background
 * @property {object[]} shapes - Serialized shape data
 * @property {object} palette - Serialized palette state
 * @property {object} params - Composition parameters
 * @property {number} createdAt
 * @property {number} updatedAt
 */

/**
 * StorageManager handles local persistence for the gallery.
 */
class StorageManager {
  constructor() {
    this._gallery = this._load();
  }

  /**
   * Load all saved paintings from localStorage
   * @private
   * @returns {SavedPainting[]}
   */
  _load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const data = JSON.parse(raw);
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }

  /**
   * Persist gallery to localStorage
   * @private
   */
  _persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this._gallery));
    } catch (e) {
      console.warn('StorageManager: could not persist gallery', e);
    }
  }

  /**
   * Save a painting to the gallery
   * @param {object} opts
   * @param {import('./geometry.js').Shape[]} opts.shapes
   * @param {string} opts.background
   * @param {object} opts.palette - palette.serialize()
   * @param {object} opts.params
   * @param {HTMLCanvasElement} opts.canvas - For thumbnail generation
   * @param {string} [opts.name]
   * @returns {SavedPainting}
   */
  savePainting({ shapes, background, palette, params, canvas, name }) {
    const id = `painting_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = Date.now();
    const thumbnail = this._makeThumbnail(canvas);

    const painting = {
      id,
      name: name || `Painting ${this._gallery.length + 1}`,
      thumbnail,
      background,
      shapes: shapes.map(s => s.toJSON()),
      palette,
      params,
      createdAt: now,
      updatedAt: now
    };

    this._gallery.unshift(painting);

    // Trim to max
    if (this._gallery.length > MAX_PAINTINGS) {
      this._gallery = this._gallery.slice(0, MAX_PAINTINGS);
    }

    this._persist();
    return painting;
  }

  /**
   * Generate a small thumbnail data URL from the canvas
   * @private
   * @param {HTMLCanvasElement} canvas
   * @returns {string}
   */
  _makeThumbnail(canvas) {
    try {
      const thumb = document.createElement('canvas');
      const size = 160;
      thumb.width = size;
      thumb.height = Math.round(size * (canvas.height / canvas.width));
      const tctx = thumb.getContext('2d');
      tctx.drawImage(canvas, 0, 0, thumb.width, thumb.height);
      return thumb.toDataURL('image/jpeg', 0.7);
    } catch {
      return '';
    }
  }

  /**
   * Get all saved paintings (most recent first)
   * @returns {SavedPainting[]}
   */
  getGallery() {
    return this._gallery.slice();
  }

  /**
   * Get a single painting by ID
   * @param {string} id
   * @returns {SavedPainting|undefined}
   */
  getPainting(id) {
    return this._gallery.find(p => p.id === id);
  }

  /**
   * Delete a painting by ID
   * @param {string} id
   * @returns {boolean}
   */
  deletePainting(id) {
    const idx = this._gallery.findIndex(p => p.id === id);
    if (idx === -1) return false;
    this._gallery.splice(idx, 1);
    this._persist();
    return true;
  }

  /**
   * Rename a painting
   * @param {string} id @param {string} name
   * @returns {boolean}
   */
  renamePainting(id, name) {
    const painting = this._gallery.find(p => p.id === id);
    if (!painting) return false;
    painting.name = name;
    painting.updatedAt = Date.now();
    this._persist();
    return true;
  }

  /**
   * Export gallery as JSON string (for backup)
   * @returns {string}
   */
  exportJSON() {
    return JSON.stringify(this._gallery, null, 2);
  }

  /**
   * Import gallery from JSON string
   * @param {string} json
   * @returns {boolean}
   */
  importJSON(json) {
    try {
      const data = JSON.parse(json);
      if (!Array.isArray(data)) return false;
      // Merge, deduplicating by id
      const existingIds = new Set(this._gallery.map(p => p.id));
      const newItems = data.filter(p => p.id && !existingIds.has(p.id));
      this._gallery = [...newItems, ...this._gallery]
        .slice(0, MAX_PAINTINGS);
      this._persist();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Clear the entire gallery
   */
  clearGallery() {
    this._gallery = [];
    this._persist();
  }

  /**
   * Save application settings
   * @param {object} settings
   */
  saveSettings(settings) {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {}
  }

  /**
   * Load application settings
   * @returns {object}
   */
  loadSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return {};
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }

  /** @returns {number} Gallery painting count */
  get count() {
    return this._gallery.length;
  }
}

export { StorageManager };
