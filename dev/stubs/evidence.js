/**
 * Core Stub: evidence.js
 * Stand-in for Person A's /core/evidence.js (Frozen API)
 * DO NOT MOVE TO /core - Keep in /dev/stubs until merge.
 */

let memoryEvidenceStore = [];

/**
 * Captures a still snapshot from a video or image source onto a canvas.
 * @param {HTMLVideoElement|HTMLImageElement|HTMLCanvasElement} source
 * @param {Object} options
 * @returns {HTMLCanvasElement}
 */
export function captureStill(source, options = {}) {
  const canvas = document.createElement('canvas');
  const sw = source.videoWidth || source.naturalWidth || source.width || 640;
  const sh = source.videoHeight || source.naturalHeight || source.height || 480;

  const width = options.width || sw;
  const height = options.height || sh;

  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  // Draw source image
  ctx.drawImage(source, 0, 0, width, height);
  return canvas;
}

/**
 * Draws bounding boxes, player tags, reasons, and danger zone annotations on canvas.
 * @param {HTMLCanvasElement} canvas
 * @param {Object} options
 *   - boxes: Array<{ x, y, width, height, label, color, isOut, reason }>
 *   - dangerZone: { x, y, width, height }
 *   - lanes: Array<{ minX, maxX, index }>
 *   - watermarkText: string
 */
export function drawEvidenceAnnotations(canvas, options = {}) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;

  // 1. Draw lanes if present (Red Light)
  if (options.lanes) {
    ctx.save();
    ctx.strokeStyle = 'rgba(224, 109, 83, 0.4)'; // Warm Terracotta tint
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 6]);
    options.lanes.forEach(lane => {
      const lx = lane.minX * w;
      ctx.beginPath();
      ctx.moveTo(lx, 0);
      ctx.lineTo(lx, h);
      ctx.stroke();

      // Lane tag
      ctx.fillStyle = 'rgba(224, 109, 83, 0.85)';
      ctx.font = 'bold 12px "Plus Jakarta Sans", sans-serif';
      ctx.fillText(`Lane ${lane.index}`, lx + 6, 20);
    });
    ctx.restore();
  }

  // 2. Draw Danger Zone if present (Hot Potato ZONE mode)
  if (options.dangerZone) {
    const zx = options.dangerZone.x * w;
    const zy = options.dangerZone.y * h;
    const zw = options.dangerZone.width * w;
    const zh = options.dangerZone.height * h;

    ctx.save();
    // Shaded danger rectangle
    ctx.fillStyle = 'rgba(186, 26, 26, 0.22)';
    ctx.fillRect(zx, zy, zw, zh);

    // Border
    ctx.strokeStyle = '#ba1a1a';
    ctx.lineWidth = 3;
    ctx.setLineDash([6, 6]);
    ctx.strokeRect(zx, zy, zw, zh);

    // Label
    ctx.fillStyle = '#ba1a1a';
    ctx.font = 'bold 13px "Plus Jakarta Sans", sans-serif';
    ctx.fillText('DANGER ZONE', zx + 8, zy + 18);
    ctx.restore();
  }

  // 3. Draw Player Bounding Boxes & Tags
  if (options.boxes && options.boxes.length > 0) {
    options.boxes.forEach(box => {
      const bx = (box.x || 0) * w;
      const by = (box.y || 0) * h;
      const bw = (box.width || 0.2) * w;
      const bh = (box.height || 0.4) * h;

      const isOut = Boolean(box.isOut);
      const strokeColor = box.color || (isOut ? '#e06d53' : '#536251'); // Terracotta or Sage
      const badgeBg = isOut ? 'rgba(224, 109, 83, 0.92)' : 'rgba(83, 98, 81, 0.92)';

      ctx.save();
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = 3;
      ctx.strokeRect(bx, by, bw, bh);

      // Name & Status Pill at top of box
      const label = box.label || 'Player';
      const statusText = isOut ? 'OUT' : 'SAFE';
      const tagText = `${label} [${statusText}]`;

      ctx.font = 'bold 12px "Plus Jakarta Sans", sans-serif';
      const textMetrics = ctx.measureText(tagText);
      const tagW = textMetrics.width + 16;
      const tagH = 22;

      ctx.fillStyle = badgeBg;
      ctx.fillRect(bx, Math.max(0, by - tagH), tagW, tagH);

      ctx.fillStyle = '#ffffff';
      ctx.fillText(tagText, bx + 8, Math.max(15, by - 6));

      // Caption / Reason below box
      if (box.reason) {
        ctx.font = '11px "Hanken Grotesk", sans-serif';
        const rMetrics = ctx.measureText(box.reason);
        const rw = rMetrics.width + 12;
        const rh = 18;

        ctx.fillStyle = 'rgba(30, 27, 24, 0.85)';
        ctx.fillRect(bx, by + bh, rw, rh);
        ctx.fillStyle = '#faf2ed';
        ctx.fillText(box.reason, bx + 6, by + bh + 13);
      }

      ctx.restore();
    });
  }

  // 4. Timestamp & Watermark
  ctx.save();
  ctx.font = '10px "Plus Jakarta Sans", sans-serif';
  ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
  const wm = options.watermarkText || `Kinship Vision Evidence • ${new Date().toLocaleTimeString()}`;
  ctx.fillText(wm, 10, h - 10);
  ctx.restore();

  return canvas;
}

/**
 * Creates and stores an evidence record with data URL.
 * @param {Object} item
 * @returns {Object} evidenceItem
 */
export function saveEvidence(item) {
  const record = {
    id: `ev_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
    timestamp: item.timestamp || Date.now(),
    title: item.title || 'Game Evidence Snapshot',
    reason: item.reason || 'Vision event detected',
    imageUri: item.imageUri || null,
    player: item.player || null,
    verdict: item.verdict || null,
    meta: item.meta || {}
  };

  memoryEvidenceStore.unshift(record);
  return record;
}

export function getEvidenceList() {
  return [...memoryEvidenceStore];
}

export function clearEvidence() {
  memoryEvidenceStore = [];
}
