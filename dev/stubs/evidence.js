/**
 * Aqaarib Media Engine - Evidence Capture & Visual Annotator
 */

let memoryEvidenceStore = [];

export function captureStill(source, options = {}) {
  const canvas = document.createElement('canvas');
  const sw = source.videoWidth || source.naturalWidth || source.width || 640;
  const sh = source.videoHeight || source.naturalHeight || source.height || 480;

  const width = options.width || sw;
  const height = options.height || sh;

  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(source, 0, 0, width, height);
  return canvas;
}

export function drawEvidenceAnnotations(canvas, options = {}) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;

  // 1. Lanes
  if (options.lanes) {
    ctx.save();
    ctx.strokeStyle = 'rgba(224, 109, 83, 0.55)';
    ctx.lineWidth = 2.5;
    ctx.setLineDash([8, 6]);
    options.lanes.forEach(lane => {
      const lx = lane.minX * w;
      ctx.beginPath();
      ctx.moveTo(lx, 0);
      ctx.lineTo(lx, h);
      ctx.stroke();

      ctx.fillStyle = 'rgba(224, 109, 83, 0.95)';
      ctx.font = 'bold 12px "Plus Jakarta Sans", sans-serif';
      ctx.fillText(`Lane ${lane.index}`, lx + 6, 22);
    });
    ctx.restore();
  }

  // 2. Danger Zone
  if (options.dangerZone) {
    const zx = options.dangerZone.x * w;
    const zy = options.dangerZone.y * h;
    const zw = options.dangerZone.width * w;
    const zh = options.dangerZone.height * h;

    ctx.save();
    ctx.fillStyle = 'rgba(186, 26, 26, 0.28)';
    ctx.fillRect(zx, zy, zw, zh);

    ctx.strokeStyle = '#ba1a1a';
    ctx.lineWidth = 3.5;
    ctx.setLineDash([8, 6]);
    ctx.strokeRect(zx, zy, zw, zh);

    ctx.fillStyle = '#ba1a1a';
    ctx.font = 'bold 14px "Plus Jakarta Sans", sans-serif';
    ctx.fillText('⚠️ DANGER ZONE', zx + 10, zy + 22);
    ctx.restore();
  }

  // 3. Highlight Rectangles over People
  if (options.boxes && options.boxes.length > 0) {
    options.boxes.forEach(box => {
      const bx = (box.x || 0) * w;
      const by = (box.y || 0) * h;
      const bw = (box.width || 0.2) * w;
      const bh = (box.height || 0.4) * h;

      const isOut = Boolean(box.isOut);
      const strokeColor = isOut ? '#d32f2f' : '#2e7d32';
      const badgeBg = isOut ? 'rgba(211, 47, 47, 0.92)' : 'rgba(46, 125, 50, 0.92)';

      ctx.save();
      // Outer glow and rectangle
      ctx.shadowColor = strokeColor;
      ctx.shadowBlur = 10;
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = 4;
      ctx.strokeRect(bx, by, bw, bh);
      ctx.shadowBlur = 0;

      // Status Badge
      const label = box.label || 'Player';
      const statusText = isOut ? 'OUT' : 'SAFE';
      const tagText = `${label} [${statusText}]`;

      ctx.font = 'bold 13px "Plus Jakarta Sans", sans-serif';
      const textMetrics = ctx.measureText(tagText);
      const tagW = textMetrics.width + 18;
      const tagH = 26;

      ctx.fillStyle = badgeBg;
      ctx.fillRect(bx, Math.max(0, by - tagH), tagW, tagH);

      ctx.fillStyle = '#ffffff';
      ctx.fillText(tagText, bx + 9, Math.max(18, by - 8));

      // Caption below box
      if (box.reason) {
        ctx.font = '12px "Hanken Grotesk", sans-serif';
        const rMetrics = ctx.measureText(box.reason);
        const rw = rMetrics.width + 14;
        const rh = 22;

        ctx.fillStyle = 'rgba(24, 21, 18, 0.88)';
        ctx.fillRect(bx, by + bh, rw, rh);
        ctx.fillStyle = '#faf2ed';
        ctx.fillText(box.reason, bx + 7, by + bh + 15);
      }

      ctx.restore();
    });
  }

  // 4. Watermark & Date
  ctx.save();
  ctx.font = '11px "Plus Jakarta Sans", sans-serif';
  ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
  const wm = options.watermarkText || `Aqaarib Snapshot • ${new Date().toLocaleTimeString()}`;
  ctx.fillText(wm, 12, h - 12);
  ctx.restore();

  return canvas;
}

export function saveEvidence(item) {
  const record = {
    id: `ev_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
    timestamp: item.timestamp || Date.now(),
    title: item.title || 'Evidence Snapshot',
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
