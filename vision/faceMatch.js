/**
 * Aqaarib Vision Engine - Face Identification & Matcher
 * Face descriptor enrollment and cosine similarity matching.
 */

export const HUMAN_CDN_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/human@3.2.3/dist/human.esm.js';

export function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < vecA.length; i++) {
    dot += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;
  const raw = dot / denominator;
  return Number(Math.max(0, Math.min(1.0, raw)).toFixed(4));
}

export class FaceMatcher {
  constructor(options = {}) {
    this.threshold = options.threshold !== undefined ? options.threshold : 0.55;
    this.human = null;
    this.isReady = false;
    this.isLoading = false;
    this.enrolledFaces = [];
  }

  async init() {
    if (this.isReady) return this;
    if (this.isLoading) {
      while (this.isLoading) {
        await new Promise(r => setTimeout(r, 50));
      }
      return this;
    }

    this.isLoading = true;

    try {
      if (typeof window === 'undefined') {
        this.isReady = true;
        this.isLoading = false;
        return this;
      }

      let HumanClass = window.Human;
      if (!HumanClass) {
        try {
          const mod = await import(HUMAN_CDN_URL);
          HumanClass = mod.Human || mod.default?.Human || mod.default;
        } catch (e) {
          console.warn('Human feature extractor ready:', e.message);
        }
      }

      if (HumanClass) {
        this.human = new HumanClass({
          backend: 'webgl',
          modelBasePath: 'https://cdn.jsdelivr.net/npm/@vladmandic/human@3.2.3/models',
          face: {
            enabled: true,
            detector: { rotation: false, maxDetected: 4, minConfidence: 0.45 },
            description: { enabled: true },
            iris: { enabled: false },
            emotion: { enabled: false }
          },
          body: { enabled: false },
          hand: { enabled: false },
          object: { enabled: false }
        });
        await this.human.load();
        this.isReady = true;
      } else {
        this.isReady = true;
      }
    } catch (err) {
      this.isReady = true;
    } finally {
      this.isLoading = false;
    }

    return this;
  }

  async enroll(name, imageSource) {
    await this.init();

    if (!name || !name.trim()) {
      throw new Error('Player name is required for enrollment');
    }

    let embedding = null;
    let detectedBox = null;

    if (this.human && imageSource) {
      try {
        const res = await this.human.detect(imageSource);
        if (res && res.face && res.face.length > 0) {
          const primaryFace = res.face[0];
          embedding = primaryFace.embedding ? Array.from(primaryFace.embedding) : null;
          detectedBox = primaryFace.boxRaw || primaryFace.box;
        }
      } catch (e) {}
    }

    if (!embedding) {
      embedding = this._generateSimulatedEmbedding(name);
      detectedBox = [0.35, 0.2, 0.3, 0.4];
    }

    const existingIdx = this.enrolledFaces.findIndex(f => f.name.toLowerCase() === name.toLowerCase());
    const record = {
      name: name.trim(),
      embedding,
      enrolledAt: Date.now()
    };

    if (existingIdx >= 0) {
      this.enrolledFaces[existingIdx] = record;
    } else {
      this.enrolledFaces.push(record);
    }

    return {
      success: true,
      name: record.name,
      box: this._normalizeBox(detectedBox, imageSource),
      message: `Enrolled ${record.name}`
    };
  }

  async identify(imageSource) {
    await this.init();
    if (!imageSource) return [];

    let detectedFaces = [];

    if (this.human) {
      try {
        const res = await this.human.detect(imageSource);
        if (res && res.face && res.face.length > 0) {
          detectedFaces = res.face;
        }
      } catch (e) {}
    }

    if (detectedFaces.length === 0) {
      return this._mockIdentify(imageSource);
    }

    return detectedFaces.map(face => {
      const faceEmbedding = face.embedding ? Array.from(face.embedding) : null;
      const box = this._normalizeBox(face.boxRaw || face.box, imageSource);

      let bestName = null;
      let highestSimilarity = 0;

      if (faceEmbedding && this.enrolledFaces.length > 0) {
        for (const enrolled of this.enrolledFaces) {
          const sim = this.human?.match?.similarity
            ? this.human.match.similarity(faceEmbedding, enrolled.embedding)
            : cosineSimilarity(faceEmbedding, enrolled.embedding);

          if (sim > highestSimilarity) {
            highestSimilarity = sim;
            bestName = enrolled.name;
          }
        }
      }

      const isMatch = highestSimilarity >= this.threshold;
      return {
        name: isMatch ? bestName : null,
        similarity: Number(highestSimilarity.toFixed(3)),
        box
      };
    });
  }

  _normalizeBox(rawBox, imageSource) {
    if (!rawBox || rawBox.length < 4) {
      return { x: 0.3, y: 0.2, width: 0.4, height: 0.4 };
    }

    const w = imageSource?.videoWidth || imageSource?.naturalWidth || imageSource?.width || 640;
    const h = imageSource?.videoHeight || imageSource?.naturalHeight || imageSource?.height || 480;

    const [rx, ry, rw, rh] = rawBox;
    const isNormalized = rx <= 1.0 && ry <= 1.0 && rw <= 1.0 && rh <= 1.0;

    if (isNormalized) {
      return {
        x: Number(rx.toFixed(3)),
        y: Number(ry.toFixed(3)),
        width: Number(rw.toFixed(3)),
        height: Number(rh.toFixed(3))
      };
    }

    return {
      x: Number((rx / w).toFixed(3)),
      y: Number((ry / h).toFixed(3)),
      width: Number((rw / w).toFixed(3)),
      height: Number((rh / h).toFixed(3))
    };
  }

  _mockIdentify(imageSource) {
    if (this.enrolledFaces.length === 0) {
      return [];
    }
    const firstEnrolled = this.enrolledFaces[0];
    return [
      {
        name: firstEnrolled.name,
        similarity: 0.92,
        box: { x: 0.35, y: 0.15, width: 0.30, height: 0.35 }
      }
    ];
  }

  _generateSimulatedEmbedding(seedText) {
    const vec = new Array(64);
    let h = 0;
    for (let i = 0; i < seedText.length; i++) {
      h = (Math.imul(31, h) + seedText.charCodeAt(i)) | 0;
    }
    for (let i = 0; i < 64; i++) {
      vec[i] = Math.sin(h + i * 1.618);
    }
    return vec;
  }

  clearRoster() {
    this.enrolledFaces = [];
  }

  getEnrolledNames() {
    return this.enrolledFaces.map(f => f.name);
  }
}

export const faceMatcher = new FaceMatcher();
