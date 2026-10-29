/**
 * Evidence Store Manager
 * /core/evidence.js
 *
 * Contract: createEvidenceStore() returns {
 *   capture(imageSource, { t, caption, boxes }) returns id,
 *   addText(t, text, caption) returns id,
 *   list()
 * }
 *
 * Requirements:
 * - Image evidence: base64 JPEG with NO data URL prefix
 * - Maximum width: 640 pixels (aspect ratio maintained)
 * - Quality: ~0.7
 * - Maximum 12 evidence items per result
 * - Text evidence: plain text string
 * - boxes: array of { x, y, w, h, label } in 0 to 1 normalized coordinates
 */

import { CONFIG } from './config.js';

export function createEvidenceStore() {
  const items = [];
  let counter = 1;
  const MAX_ITEMS = CONFIG.MAX_EVIDENCE_ITEMS || 12;
  const MAX_WIDTH = CONFIG.MAX_EVIDENCE_WIDTH || 640;
  const QUALITY = CONFIG.JPEG_QUALITY || 0.7;

  function pruneToMax() {
    while (items.length > MAX_ITEMS) {
      items.shift();
    }
  }

  return {
    capture(imageSource, { t = 0, caption = '', boxes = [] } = {}) {
      const id = `ev${counter++}`;
      const isBrowser = typeof window !== 'undefined' && typeof document !== 'undefined';

      let base64Data = '';

      if (isBrowser && imageSource) {
        try {
          const srcWidth = imageSource.videoWidth || imageSource.naturalWidth || imageSource.width || 640;
          const srcHeight = imageSource.videoHeight || imageSource.naturalHeight || imageSource.height || 480;

          // Scale down to max width 640 while maintaining aspect ratio
          const scale = srcWidth > MAX_WIDTH ? MAX_WIDTH / srcWidth : 1;
          const targetWidth = Math.round(srcWidth * scale);
          const targetHeight = Math.round(srcHeight * scale);

          const canvas = document.createElement('canvas');
          canvas.width = targetWidth;
          canvas.height = targetHeight;
          const ctx = canvas.getContext('2d');

          // Draw base image frame
          ctx.drawImage(imageSource, 0, 0, targetWidth, targetHeight);

          // Draw referee overlay boxes if supplied
          if (Array.isArray(boxes)) {
            boxes.forEach((box) => {
              if (!box) return;
              const bx = Math.round(box.x * targetWidth);
              const by = Math.round(box.y * targetHeight);
              const bw = Math.round(box.w * targetWidth);
              const bh = Math.round(box.h * targetHeight);

              ctx.save();
              ctx.strokeStyle = '#e06d53';
              ctx.lineWidth = 2.5;
              ctx.strokeRect(bx, by, bw, bh);

              if (box.label) {
                ctx.font = 'bold 12px sans-serif';
                const textMetrics = ctx.measureText(box.label);
                const tagHeight = 18;
                const tagWidth = textMetrics.width + 12;
                const tagY = Math.max(0, by - tagHeight);

                ctx.fillStyle = 'rgba(224, 109, 83, 0.9)';
                ctx.fillRect(bx, tagY, tagWidth, tagHeight);

                ctx.fillStyle = '#ffffff';
                ctx.fillText(box.label, bx + 6, tagY + 13);
              }
              ctx.restore();
            });
          }

          // Export base64 JPEG without data URL prefix
          const dataUrl = canvas.toDataURL('image/jpeg', QUALITY);
          base64Data = dataUrl.replace(/^data:image\/[a-z]+;base64,/, '');
        } catch (_) {
          base64Data = '';
        }
      } else {
        // Node test fallback
        base64Data = 'mock_base64_jpeg_evidence_data';
      }

      const item = {
        id,
        t: Number(Number(t).toFixed(1)),
        type: 'image',
        data: base64Data,
        caption: String(caption || 'Referee snapshot')
      };

      items.push(item);
      pruneToMax();
      return id;
    },

    addText(t = 0, text = '', caption = '') {
      const id = `ev${counter++}`;
      const item = {
        id,
        t: Number(Number(t).toFixed(1)),
        type: 'text',
        data: String(text || ''),
        caption: String(caption || 'Referee note')
      };

      items.push(item);
      pruneToMax();
      return id;
    },

    list() {
      return items.slice();
    },

    clear() {
      items.length = 0;
    }
  };
}
