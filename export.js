/**
 * export.js
 * PNG and SVG export for Abstract Painter.
 * iOS Safari: <a download> is ignored — falls back to window.open(dataURL)
 * so the user can long-press the image to save it to Photos.
 */

'use strict';

const IS_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

class ExportManager {
  /**
   * @param {import('./renderer.js').CanvasRenderer} renderer
   */
  constructor(renderer) {
    this._renderer = renderer;
  }

  /**
   * Export the current painting as PNG.
   * On iOS, opens the image in a new tab (user long-presses → Save to Photos).
   * On desktop, triggers a file download.
   * @param {import('./geometry.js').Shape[]} shapes
   * @param {string} background
   * @param {string} [filename]
   */
  exportPNG(shapes, background, filename = 'abstract-painting.png') {
    const scale = Math.max(2, window.devicePixelRatio || 2);
    const offscreen = this._renderer.renderToOffscreen(shapes, background, scale);

    if (IS_IOS) {
      // iOS: get data URL and open in new tab
      // User can then long-press → "Add to Photos" or "Save Image"
      const dataURL = offscreen.toDataURL('image/png');
      const win = window.open('', '_blank');
      if (win) {
        win.document.write(`
          <!DOCTYPE html>
          <html>
          <head>
            <meta name="viewport" content="width=device-width,initial-scale=1">
            <title>Save Painting</title>
            <style>
              body { margin: 0; background: #000; display: flex; flex-direction: column;
                     align-items: center; justify-content: center; min-height: 100vh; }
              img  { max-width: 100%; height: auto; display: block; }
              p    { color: #fff; font-family: system-ui; font-size: 14px;
                     text-align: center; padding: 16px; opacity: 0.7; }
            </style>
          </head>
          <body>
            <p>Long-press the image below and choose <strong>Save to Photos</strong></p>
            <img src="${dataURL}" alt="Abstract Painting">
          </body>
          </html>
        `);
        win.document.close();
      }
    } else {
      offscreen.toBlob((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      }, 'image/png');
    }
  }

  /**
   * Export as SVG.
   * On iOS, opens SVG source in a new tab (user can share or copy).
   * On desktop, triggers a file download.
   * @param {import('./geometry.js').Shape[]} shapes
   * @param {string} background
   * @param {string} [filename]
   */
  exportSVG(shapes, background, filename = 'abstract-painting.svg') {
    const w = this._renderer.width;
    const h = this._renderer.height;

    const svgParts = [
      `<?xml version="1.0" encoding="UTF-8"?>`,
      `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`,
      `<rect width="${w}" height="${h}" fill="${background}"/>`
    ];

    for (const shape of shapes) {
      if (shape.animProgress < 0.01) continue;
      const el = this._shapeToSVG(shape);
      if (el) svgParts.push(el);
    }
    svgParts.push('</svg>');

    const svg = svgParts.join('\n');
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    if (IS_IOS) {
      window.open(url, '_blank');
    } else {
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  /**
   * @private
   */
  _shapeToSVG(shape) {
    const opacity = shape.opacity;
    const stroke = shape.strokeColor
      ? `stroke="${shape.strokeColor}" stroke-width="${shape.strokeWidth}"`
      : 'stroke="none"';
    const transform = shape.rotation !== 0
      ? `transform="rotate(${(shape.rotation * 180 / Math.PI).toFixed(2)},${shape.x.toFixed(1)},${shape.y.toFixed(1)})"`
      : '';
    const op = `opacity="${opacity.toFixed(3)}"`;

    switch (shape.type) {
      case 'circle':
      case 'dot': {
        const r = shape.radius || 2;
        return `<circle cx="${shape.x.toFixed(1)}" cy="${shape.y.toFixed(1)}" r="${r.toFixed(1)}" fill="${shape.color}" ${stroke} ${op} ${transform}/>`;
      }
      case 'ring': {
        const ro = shape.radius, ri = shape.innerRadius;
        const d = `M ${shape.x} ${shape.y - ro} A ${ro} ${ro} 0 1 0 ${shape.x - 0.001} ${shape.y - ro} Z `
                + `M ${shape.x} ${shape.y - ri} A ${ri} ${ri} 0 1 1 ${shape.x - 0.001} ${shape.y - ri} Z`;
        return `<path d="${d}" fill="${shape.color}" fill-rule="evenodd" ${stroke} ${op} ${transform}/>`;
      }
      case 'line':
        return `<line x1="${shape.x.toFixed(1)}" y1="${shape.y.toFixed(1)}" x2="${shape.x2.toFixed(1)}" y2="${shape.y2.toFixed(1)}" stroke="${shape.color}" stroke-width="${shape.width}" stroke-linecap="${shape.cap || 'round'}" ${op}/>`;
      case 'arc': {
        const r = shape.radius;
        const sx = (shape.x + Math.cos(shape.startAngle) * r).toFixed(1);
        const sy = (shape.y + Math.sin(shape.startAngle) * r).toFixed(1);
        const ex = (shape.x + Math.cos(shape.endAngle) * r).toFixed(1);
        const ey = (shape.y + Math.sin(shape.endAngle) * r).toFixed(1);
        const large = (shape.endAngle - shape.startAngle) > Math.PI ? 1 : 0;
        const d = `M ${sx} ${sy} A ${r} ${r} 0 ${large} 1 ${ex} ${ey}`;
        return shape.fill
          ? `<path d="${d} L ${shape.x} ${shape.y} Z" fill="${shape.color}" ${op} ${transform}/>`
          : `<path d="${d}" fill="none" stroke="${shape.color}" stroke-width="${shape.width}" stroke-linecap="round" ${op} ${transform}/>`;
      }
      case 'triangle': {
        const h = shape.size * Math.sqrt(3) / 2;
        const pts = [
          `${shape.x},${(shape.y - h * 2 / 3).toFixed(1)}`,
          `${(shape.x + shape.size / 2).toFixed(1)},${(shape.y + h / 3).toFixed(1)}`,
          `${(shape.x - shape.size / 2).toFixed(1)},${(shape.y + h / 3).toFixed(1)}`
        ].join(' ');
        return `<polygon points="${pts}" fill="${shape.color}" ${stroke} ${op} ${transform}/>`;
      }
      case 'rect': {
        const rx = (shape.x - shape.w / 2).toFixed(1);
        const ry = (shape.y - shape.h / 2).toFixed(1);
        return `<rect x="${rx}" y="${ry}" width="${shape.w.toFixed(1)}" height="${shape.h.toFixed(1)}" fill="${shape.color}" ${stroke} ${op} ${transform}/>`;
      }
      case 'polygon': {
        const pts = [];
        for (let i = 0; i < shape.sides; i++) {
          const a = (i / shape.sides) * Math.PI * 2 - Math.PI / 2;
          pts.push(`${(shape.x + Math.cos(a) * shape.radius).toFixed(1)},${(shape.y + Math.sin(a) * shape.radius).toFixed(1)}`);
        }
        return `<polygon points="${pts.join(' ')}" fill="${shape.color}" ${stroke} ${op} ${transform}/>`;
      }
      case 'curve': {
        const d = `M ${shape.x.toFixed(1)} ${shape.y.toFixed(1)} Q ${shape.cx.toFixed(1)} ${shape.cy.toFixed(1)} ${shape.x2.toFixed(1)} ${shape.y2.toFixed(1)}`;
        return `<path d="${d}" fill="none" stroke="${shape.color}" stroke-width="${shape.width}" stroke-linecap="round" ${op}/>`;
      }
      case 'spline': {
        if (!shape.points?.length) return null;
        const pts = shape.points.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
        return `<polyline points="${pts}" fill="none" stroke="${shape.color}" stroke-width="${shape.width}" stroke-linecap="round" stroke-linejoin="round" ${op}/>`;
      }
      case 'starburst': {
        const pts = [];
        for (let i = 0; i < shape.points * 2; i++) {
          const a = (i / (shape.points * 2)) * Math.PI * 2 - Math.PI / 2;
          const r = i % 2 === 0 ? shape.outerRadius : shape.innerRadius;
          pts.push(`${(shape.x + Math.cos(a) * r).toFixed(1)},${(shape.y + Math.sin(a) * r).toFixed(1)}`);
        }
        return `<polygon points="${pts.join(' ')}" fill="${shape.color}" ${stroke} ${op} ${transform}/>`;
      }
      default:
        return null;
    }
  }
}

export { ExportManager };
