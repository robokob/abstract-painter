export const DEFAULT_EFFECTS = Object.freeze({
  glow: 0.25,
  blur: 0.2,
  grain: 0.12,
  vignette: 0.35,
  saturation: 1.15
});

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function normalizeEffects(input = {}) {
  const base = { ...DEFAULT_EFFECTS };
  for (const key of Object.keys(base)) {
    const raw = Number(input[key]);
    if (!Number.isFinite(raw)) continue;
    if (key === 'saturation') {
      base[key] = clamp(raw, 0.4, 2.2);
    } else if (key === 'grain' || key === 'glow' || key === 'blur' || key === 'vignette') {
      base[key] = clamp(raw, 0, 1);
    }
  }
  return base;
}

export function buildCanvasFilter(effects = {}) {
  const normalized = normalizeEffects(effects);
  const glowBoost = 1 + normalized.glow * 0.85;
  const contrastBoost = 1 + normalized.glow * 0.5;
  return `saturate(${normalized.saturation}) contrast(${contrastBoost}) brightness(${glowBoost}) blur(${normalized.blur}px)`;
}
