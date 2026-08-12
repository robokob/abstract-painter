/**
 * palette.js
 * Color palette definitions and management for Abstract Painter.
 * All palettes are original compositions inspired by abstract art theory.
 */

'use strict';

/** @typedef {{ name: string, colors: string[], background: string[] }} PaletteDefinition */

/** All available built-in palettes */
const PALETTES = {
  primary: {
    name: 'Primary',
    colors: [
      '#D62828', '#F77F00', '#FCBF49', '#003049', '#0077B6',
      '#FFFFFF', '#1A1A2E', '#E63946', '#457B9D', '#A8DADC'
    ],
    background: ['#F1FAEE', '#1A1A2E', '#16213E', '#FFFFFF']
  },
  warm: {
    name: 'Warm',
    colors: [
      '#FF6B35', '#F7C59F', '#EFEFD0', '#004E89', '#1A936F',
      '#C9184A', '#FF4D6D', '#FF8500', '#FFBA08', '#E85D04'
    ],
    background: ['#FFF3E0', '#1C0A00', '#2D1B00', '#3D0000']
  },
  cold: {
    name: 'Cold',
    colors: [
      '#03045E', '#0077B6', '#00B4D8', '#90E0EF', '#CAF0F8',
      '#023E8A', '#48CAE4', '#ADE8F4', '#7209B7', '#3A0CA3'
    ],
    background: ['#03045E', '#0A0A2E', '#CAF0F8', '#E0F7FA']
  },
  earth: {
    name: 'Earth',
    colors: [
      '#582F0E', '#7F4F24', '#936639', '#A68A64', '#B6AD90',
      '#C2C5AA', '#A4AC86', '#656D4A', '#414833', '#333D29'
    ],
    background: ['#FEFAE0', '#1A0F00', '#2C1A00', '#DDA15E']
  },
  monochrome: {
    name: 'Monochrome',
    colors: [
      '#FFFFFF', '#E0E0E0', '#BDBDBD', '#9E9E9E', '#757575',
      '#616161', '#424242', '#212121', '#000000', '#F5F5F5'
    ],
    background: ['#FFFFFF', '#121212', '#FAFAFA', '#1E1E1E']
  },
  pastel: {
    name: 'Pastel',
    colors: [
      '#FFD6FF', '#E7C6FF', '#C8B6FF', '#B8C0FF', '#BBD0FF',
      '#FFCCD5', '#FFB3C1', '#FF8FAB', '#FB6F92', '#FFE5D9'
    ],
    background: ['#FFF0F3', '#F8F0FC', '#EEF2FF', '#F0F4FF']
  },
  neon: {
    name: 'Neon',
    colors: [
      '#FF006E', '#FB5607', '#FFBE0B', '#3A86FF', '#8338EC',
      '#06FFB4', '#FF4ADE', '#00F5FF', '#ADFF02', '#FF3CAC'
    ],
    background: ['#0D0D0D', '#050505', '#0A001F', '#001A00']
  },
  sunset: {
    name: 'Sunset',
    colors: [
      '#FF595E', '#FF924C', '#FFCA3A', '#6A4C93', '#1982C4',
      '#8AC926', '#FF595E', '#C77DFF', '#E040FB', '#FF6D00'
    ],
    background: ['#1A1A2E', '#0F0C29', '#302B63', '#24243E']
  }
};

/**
 * PaletteManager handles palette selection, locking, and color retrieval.
 */
class PaletteManager {
  constructor() {
    /** @type {string} Current palette key */
    this._currentKey = 'primary';
    /** @type {boolean} Whether palette is locked */
    this._locked = false;
    /** @type {string[]|null} Custom palette colors */
    this._customColors = null;
    /** @type {string[]|null} Custom background colors */
    this._customBackgrounds = null;
    /** @type {PaletteDefinition} Active palette */
    this._activePalette = PALETTES[this._currentKey];
  }

  /** @returns {string[]} All available palette keys */
  static getKeys() {
    return Object.keys(PALETTES);
  }

  /** @returns {PaletteDefinition[]} All palette definitions */
  static getAll() {
    return Object.entries(PALETTES).map(([key, def]) => ({ key, ...def }));
  }

  /** @param {string} key */
  setPalette(key) {
    if (PALETTES[key]) {
      this._currentKey = key;
      this._activePalette = PALETTES[key];
      this._customColors = null;
    }
  }

  /** @param {string[]} colors @param {string[]} backgrounds */
  setCustomPalette(colors, backgrounds = ['#1a1a2e']) {
    this._customColors = colors.slice();
    this._customBackgrounds = backgrounds.slice();
    this._currentKey = 'custom';
  }

  /** Set palette to random */
  randomize() {
    const keys = Object.keys(PALETTES);
    const key = keys[Math.floor(Math.random() * keys.length)];
    this.setPalette(key);
    return key;
  }

  /** @param {boolean} locked */
  setLocked(locked) {
    this._locked = locked;
  }

  /** @returns {boolean} */
  isLocked() {
    return this._locked;
  }

  /** @returns {string} Current palette key */
  getCurrentKey() {
    return this._currentKey;
  }

  /** @returns {string[]} Active colors array */
  getColors() {
    if (this._customColors) return this._customColors;
    return this._activePalette.colors;
  }

  /** @returns {string[]} Active background colors */
  getBackgrounds() {
    if (this._customBackgrounds) return this._customBackgrounds;
    return this._activePalette.background;
  }

  /**
   * Pick a random color from the active palette
   * @param {number} [alpha=1] - Opacity 0..1
   * @returns {string} CSS color string
   */
  randomColor(alpha = 1) {
    const colors = this.getColors();
    const hex = colors[Math.floor(Math.random() * colors.length)];
    if (alpha >= 1) return hex;
    return hexToRgba(hex, alpha);
  }

  /**
   * Pick a random background color
   * @returns {string}
   */
  randomBackground() {
    const bgs = this.getBackgrounds();
    return bgs[Math.floor(Math.random() * bgs.length)];
  }

  /**
   * Get a harmonious color pair (contrasting or analogous)
   * @returns {[string, string]}
   */
  harmonicPair() {
    const colors = this.getColors();
    const idx1 = Math.floor(Math.random() * colors.length);
    let idx2 = (idx1 + Math.floor(colors.length / 2)) % colors.length;
    return [colors[idx1], colors[idx2]];
  }

  /**
   * Serialize palette state
   * @returns {object}
   */
  serialize() {
    return {
      key: this._currentKey,
      locked: this._locked,
      customColors: this._customColors,
      customBackgrounds: this._customBackgrounds
    };
  }

  /**
   * Restore from serialized state
   * @param {object} data
   */
  deserialize(data) {
    if (data.key && PALETTES[data.key]) {
      this.setPalette(data.key);
    }
    if (data.customColors) {
      this.setCustomPalette(data.customColors, data.customBackgrounds || ['#1a1a2e']);
    }
    this._locked = !!data.locked;
  }
}

/**
 * Convert hex color + alpha to rgba string
 * @param {string} hex
 * @param {number} alpha
 * @returns {string}
 */
function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha.toFixed(3)})`;
}

/**
 * Lighten or darken a hex color
 * @param {string} hex
 * @param {number} amount - positive to lighten, negative to darken
 * @returns {string}
 */
function shiftColor(hex, amount) {
  let r = parseInt(hex.slice(1, 3), 16);
  let g = parseInt(hex.slice(3, 5), 16);
  let b = parseInt(hex.slice(5, 7), 16);
  r = Math.min(255, Math.max(0, r + amount));
  g = Math.min(255, Math.max(0, g + amount));
  b = Math.min(255, Math.max(0, b + amount));
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

export { PaletteManager, PALETTES, hexToRgba, shiftColor };
