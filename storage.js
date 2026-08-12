/**
 * storage.js
 * Persistence layer for Abstract Painter.
 * Manages: gallery paintings, user palettes, user shape sets, app settings.
 */

'use strict';

const STORAGE_KEY         = 'abstractPainter_gallery';
const SETTINGS_KEY        = 'abstractPainter_settings';
const USER_PALETTES_KEY   = 'abstractPainter_userPalettes';
const USER_SHAPES_KEY     = 'abstractPainter_userShapes';
const MAX_PAINTINGS       = 50;
const MAX_USER_PALETTES   = 30;
const MAX_USER_SHAPE_SETS = 30;

/**
 * @typedef {object} UserPalette
 * @property {string}   id
 * @property {string}   name
 * @property {string[]} colors      - hex strings, e.g. "#ff0000"
 * @property {string[]} backgrounds - hex strings
 * @property {number}   createdAt
 */

/**
 * @typedef {object} UserShapeSet
 * @property {string}   id
 * @property {string}   name
 * @property {object[]} shapes   - array of shape.toJSON() objects
 * @property {number}   createdAt
 */

/**
 * @typedef {object} SavedPainting
 * @property {string}   id
 * @property {string}   name
 * @property {string}   thumbnail
 * @property {string}   background
 * @property {object[]} shapes
 * @property {object}   palette
 * @property {object}   params
 * @property {number}   createdAt
 * @property {number}   updatedAt
 */

class StorageManager {
  constructor() {
    this._gallery      = this._loadKey(STORAGE_KEY,       []);
    this._userPalettes = this._loadKey(USER_PALETTES_KEY, []);
    this._userShapes   = this._loadKey(USER_SHAPES_KEY,   []);
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  _loadKey(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      const data = JSON.parse(raw);
      return Array.isArray(data) ? data : fallback;
    } catch { return fallback; }
  }

  _saveKey(key, data) {
    try { localStorage.setItem(key, JSON.stringify(data)); }
    catch (e) { console.warn(`[Storage] Could not save ${key}:`, e); }
  }

  _uid(prefix) {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  }

  // ─── Gallery ────────────────────────────────────────────────────────────────

  savePainting({ shapes, background, palette, params, canvas, name }) {
    const thumbnail = this._makeThumbnail(canvas);
    const now = Date.now();
    const entry = {
      id: this._uid('p'),
      name: name || `Painting ${this._gallery.length + 1}`,
      thumbnail,
      background,
      shapes: shapes.map(s => s.toJSON()),
      palette,
      params,
      createdAt: now,
      updatedAt: now
    };
    this._gallery.unshift(entry);
    if (this._gallery.length > MAX_PAINTINGS) this._gallery.length = MAX_PAINTINGS;
    this._saveKey(STORAGE_KEY, this._gallery);
    return entry;
  }

  _makeThumbnail(canvas) {
    try {
      const t = document.createElement('canvas');
      t.width  = 160;
      t.height = Math.round(160 * canvas.height / canvas.width);
      t.getContext('2d').drawImage(canvas, 0, 0, t.width, t.height);
      return t.toDataURL('image/jpeg', 0.7);
    } catch { return ''; }
  }

  getGallery()       { return this._gallery.slice(); }
  getPainting(id)    { return this._gallery.find(p => p.id === id); }

  deletePainting(id) {
    const i = this._gallery.findIndex(p => p.id === id);
    if (i === -1) return false;
    this._gallery.splice(i, 1);
    this._saveKey(STORAGE_KEY, this._gallery);
    return true;
  }

  renamePainting(id, name) {
    const p = this._gallery.find(p => p.id === id);
    if (!p) return false;
    p.name = name; p.updatedAt = Date.now();
    this._saveKey(STORAGE_KEY, this._gallery);
    return true;
  }

  exportGalleryJSON() { return JSON.stringify(this._gallery, null, 2); }

  importGalleryJSON(json) {
    try {
      const data = JSON.parse(json);
      if (!Array.isArray(data)) return false;
      const ids = new Set(this._gallery.map(p => p.id));
      const fresh = data.filter(p => p.id && !ids.has(p.id));
      this._gallery = [...fresh, ...this._gallery].slice(0, MAX_PAINTINGS);
      this._saveKey(STORAGE_KEY, this._gallery);
      return true;
    } catch { return false; }
  }

  get count() { return this._gallery.length; }

  // ─── User Palettes ──────────────────────────────────────────────────────────

  /** @returns {UserPalette[]} */
  getUserPalettes() { return this._userPalettes.slice(); }

  /**
   * Save a new user palette
   * @param {string}   name
   * @param {string[]} colors
   * @param {string[]} backgrounds
   * @returns {UserPalette}
   */
  saveUserPalette(name, colors, backgrounds = ['#1a1a2e']) {
    const entry = {
      id: this._uid('pal'),
      name: name || `Palette ${this._userPalettes.length + 1}`,
      colors: colors.filter(c => /^#[0-9a-f]{6}$/i.test(c)),
      backgrounds: backgrounds.filter(c => /^#[0-9a-f]{6}$/i.test(c)),
      createdAt: Date.now()
    };
    if (entry.colors.length === 0) throw new Error('Palette must have at least one valid color');
    this._userPalettes.unshift(entry);
    if (this._userPalettes.length > MAX_USER_PALETTES) this._userPalettes.length = MAX_USER_PALETTES;
    this._saveKey(USER_PALETTES_KEY, this._userPalettes);
    return entry;
  }

  deleteUserPalette(id) {
    const i = this._userPalettes.findIndex(p => p.id === id);
    if (i === -1) return false;
    this._userPalettes.splice(i, 1);
    this._saveKey(USER_PALETTES_KEY, this._userPalettes);
    return true;
  }

  renameUserPalette(id, name) {
    const p = this._userPalettes.find(p => p.id === id);
    if (!p) return false;
    p.name = name;
    this._saveKey(USER_PALETTES_KEY, this._userPalettes);
    return true;
  }

  exportUserPalettesJSON() { return JSON.stringify(this._userPalettes, null, 2); }

  importUserPalettesJSON(json) {
    try {
      const data = JSON.parse(json);
      const items = Array.isArray(data) ? data : [data]; // accept single object too
      const ids = new Set(this._userPalettes.map(p => p.id));
      let added = 0;
      for (const item of items) {
        if (!item.colors || !Array.isArray(item.colors)) continue;
        const entry = {
          id:          item.id && !ids.has(item.id) ? item.id : this._uid('pal'),
          name:        item.name || `Imported Palette ${this._userPalettes.length + 1}`,
          colors:      item.colors.filter(c => /^#[0-9a-f]{6}$/i.test(c)),
          backgrounds: (item.backgrounds || ['#1a1a2e']).filter(c => /^#[0-9a-f]{6}$/i.test(c)),
          createdAt:   item.createdAt || Date.now()
        };
        if (entry.colors.length === 0) continue;
        if (!ids.has(entry.id)) { this._userPalettes.push(entry); ids.add(entry.id); added++; }
      }
      this._userPalettes = this._userPalettes.slice(0, MAX_USER_PALETTES);
      this._saveKey(USER_PALETTES_KEY, this._userPalettes);
      return added;
    } catch { return 0; }
  }

  // ─── User Shape Sets ────────────────────────────────────────────────────────

  /** @returns {UserShapeSet[]} */
  getUserShapeSets() { return this._userShapes.slice(); }

  /**
   * Save a new user shape set
   * @param {string}   name
   * @param {object[]} shapes  - raw shape JSON objects
   * @returns {UserShapeSet}
   */
  saveUserShapeSet(name, shapes) {
    const valid = shapes.filter(s => s && typeof s.type === 'string');
    if (valid.length === 0) throw new Error('Shape set must contain at least one valid shape');
    const entry = {
      id:        this._uid('ss'),
      name:      name || `Shape Set ${this._userShapes.length + 1}`,
      shapes:    valid,
      createdAt: Date.now()
    };
    this._userShapes.unshift(entry);
    if (this._userShapes.length > MAX_USER_SHAPE_SETS) this._userShapes.length = MAX_USER_SHAPE_SETS;
    this._saveKey(USER_SHAPES_KEY, this._userShapes);
    return entry;
  }

  deleteUserShapeSet(id) {
    const i = this._userShapes.findIndex(s => s.id === id);
    if (i === -1) return false;
    this._userShapes.splice(i, 1);
    this._saveKey(USER_SHAPES_KEY, this._userShapes);
    return true;
  }

  renameUserShapeSet(id, name) {
    const s = this._userShapes.find(s => s.id === id);
    if (!s) return false;
    s.name = name;
    this._saveKey(USER_SHAPES_KEY, this._userShapes);
    return true;
  }

  exportUserShapesJSON() { return JSON.stringify(this._userShapes, null, 2); }

  importUserShapesJSON(json, name) {
    try {
      const data = JSON.parse(json);
      const isShapeObj = (o) => !!o && typeof o === 'object' && typeof o.type === 'string';
      const isSetObj    = (o) => !!o && typeof o === 'object' && Array.isArray(o.shapes);

      // Normalize input into a list of "set" objects ({ name?, shapes: [...] })
      let sets;
      if (Array.isArray(data)) {
        // Array of shape sets (round-trip export format) vs. a flat array of raw shapes
        sets = data.every(isSetObj) ? data : [{ name, shapes: data.filter(isShapeObj) }];
      } else if (isSetObj(data)) {
        sets = [data];
      } else if (isShapeObj(data)) {
        sets = [{ name, shapes: [data] }];
      } else {
        sets = [];
      }

      const ids = new Set(this._userShapes.map(s => s.id));
      let added = 0;
      for (const item of sets) {
        const valid = (item.shapes || []).filter(isShapeObj);
        if (valid.length === 0) continue;
        const entry = {
          id:        item.id && !ids.has(item.id) ? item.id : this._uid('ss'),
          name:      item.name || name || `Imported Shapes ${this._userShapes.length + 1}`,
          shapes:    valid,
          createdAt: item.createdAt || Date.now()
        };
        if (!ids.has(entry.id)) { this._userShapes.push(entry); ids.add(entry.id); added++; }
      }
      this._userShapes = this._userShapes.slice(0, MAX_USER_SHAPE_SETS);
      this._saveKey(USER_SHAPES_KEY, this._userShapes);
      return added;
    } catch { return 0; }
  }

  // ─── Settings ───────────────────────────────────────────────────────────────

  saveSettings(settings) {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch {}
  }

  loadSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  }
}

export { StorageManager };
