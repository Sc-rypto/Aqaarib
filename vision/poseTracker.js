/**
 * Shared Vision Layer: poseTracker.js
 * Person B Implementation
 *
 * Wraps MediaPipe Pose Landmarker (@mediapipe/tasks-vision, pinned version).
 * - Video mode for live gameplay (~15 fps at reduced resolution)
 * - Image mode for still frame judgments (Hot Potato)
 * - Multi-person tracking: up to 4 people
 * - Detect returns: [{ landmarks, torsoCenter, boundingBox, visibilityCount }, ...]
 * - Switchable asset base URL for /vendor fallback
 */

// Pinned asset and model URLs (can be switched to /vendor if offline)
export const MEDIAPIPE_CONFIG = {
  wasmBaseUrl: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm',
  modelAssetUrl: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
  // Local fallback paths if self-hosted in /vendor
  vendorWasmBaseUrl: '/vendor/tasks-vision/wasm',
  vendorModelAssetUrl: '/vendor/models/pose_landmarker_lite.task'
};

export class PoseTracker {
  constructor(options = {}) {
    this.maxPoses = options.maxPoses || 4;
    this.wasmBaseUrl = options.wasmBaseUrl || MEDIAPIPE_CONFIG.wasmBaseUrl;
    this.modelAssetUrl = options.modelAssetUrl || MEDIAPIPE_CONFIG.modelAssetUrl;
    this.runningMode = options.runningMode || 'VIDEO'; // 'VIDEO' or 'IMAGE'

    this.landmarker = null;
    this.isLoading = false;
    this.isReady = false;
    this.lastVideoTime = -1;

    // Reduced resolution offscreen canvas for fast 15fps inference
    this.downscaleWidth = options.downscaleWidth || 360;
    this.downscaleHeight = options.downscaleHeight || 270;
    this.offscreenCanvas = null;
    this.offscreenCtx = null;
  }

  /**
   * Initializes the MediaPipe PoseLandmarker instance.
   */
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
        // Node / Headless environment fallback
        this.isReady = true;
        this.isLoading = false;
        return this;
      }

      // Prepare offscreen canvas for resolution reduction
      if (!this.offscreenCanvas) {
        this.offscreenCanvas = document.createElement('canvas');
        this.offscreenCanvas.width = this.downscaleWidth;
        this.offscreenCanvas.height = this.downscaleHeight;
        this.offscreenCtx = this.offscreenCanvas.getContext('2d', { willReadFrequently: true });
      }

      // Load MediaPipe Tasks Vision dynamically if not already on window
      let vision = window.tasksVision || window.FilesetResolver;
      if (!vision) {
        try {
          const module = await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/+esm');
          vision = module;
        } catch (cdnErr) {
          console.warn('Failed to import MediaPipe from primary CDN, checking global...', cdnErr);
        }
      }

      if (vision && vision.FilesetResolver && vision.PoseLandmarker) {
        const filesetResolver = await vision.FilesetResolver.forVisionTasks(this.wasmBaseUrl);
        this.landmarker = await vision.PoseLandmarker.createFromOptions(filesetResolver, {
          baseOptions: {
            modelAssetPath: this.modelAssetUrl,
            delegate: 'GPU'
          },
          runningMode: this.runningMode,
          numPoses: this.maxPoses,
          minPoseDetectionConfidence: 0.5,
          minPosePresenceConfidence: 0.5,
          minTrackingConfidence: 0.5
        });
        this.isReady = true;
      } else {
        console.warn('MediaPipe library not available; running in simulated vision mode.');
        this.isReady = true;
      }
    } catch (err) {
      console.warn('Could not initialize MediaPipe PoseLandmarker (using fallback):', err);
      this.isReady = true; // Still allow app to function with fallback
    } finally {
      this.isLoading = false;
    }

    return this;
  }

  /**
   * Switches running mode between 'VIDEO' and 'IMAGE'
   */
  async setRunningMode(mode) {
    if (this.runningMode === mode) return;
    this.runningMode = mode;
    if (this.landmarker && this.landmarker.setOptions) {
      await this.landmarker.setOptions({ runningMode: mode });
    }
  }

  /**
   * Runs pose detection on a video stream or image element.
   * @param {HTMLVideoElement|HTMLImageElement|HTMLCanvasElement} source
   * @param {number} timestampMs
   * @returns {Array<Object>} Array of detected people:
   *   [{ landmarks, torsoCenter, boundingBox, visibilityCount }, ...]
   */
  detect(source, timestampMs = performance.now()) {
    if (!source) return [];

    let results = null;

    if (this.landmarker) {
      try {
        if (this.runningMode === 'VIDEO') {
          // If source is a video, only process if frame is new
          if (source.currentTime !== undefined && source.currentTime === this.lastVideoTime) {
            return this.lastPeopleResult || [];
          }
          if (source.currentTime !== undefined) {
            this.lastVideoTime = source.currentTime;
          }

          // Render to reduced-resolution canvas for speed
          if (this.offscreenCtx && source.videoWidth) {
            this.offscreenCtx.drawImage(source, 0, 0, this.downscaleWidth, this.downscaleHeight);
            results = this.landmarker.detectForVideo(this.offscreenCanvas, Math.round(timestampMs));
          } else {
            results = this.landmarker.detectForVideo(source, Math.round(timestampMs));
          }
        } else {
          // IMAGE mode for still frame
          results = this.landmarker.detect(source);
        }
      } catch (e) {
        console.error('PoseLandmarker inference error:', e);
      }
    }

    const people = this._formatLandmarkerResults(results, source);
    this.lastPeopleResult = people;
    return people;
  }

  /**
   * Transforms raw MediaPipe PoseLandmarker output into the standard Person format.
   */
  _formatLandmarkerResults(results, source) {
    if (!results || !results.landmarks || results.landmarks.length === 0) {
      return [];
    }

    return results.landmarks.map((landmarks, index) => {
      // 1. Torso Center: Average of shoulders (11, 12) and hips (23, 24)
      const l11 = landmarks[11] || { x: 0.5, y: 0.4 };
      const l12 = landmarks[12] || { x: 0.5, y: 0.4 };
      const l23 = landmarks[23] || { x: 0.5, y: 0.6 };
      const l24 = landmarks[24] || { x: 0.5, y: 0.6 };

      const torsoCenter = {
        x: Number(((l11.x + l12.x + l23.x + l24.x) / 4).toFixed(4)),
        y: Number(((l11.y + l12.y + l23.y + l24.y) / 4).toFixed(4))
      };

      // 2. Normalized Bounding Box
      let minX = 1.0;
      let maxX = 0.0;
      let minY = 1.0;
      let maxY = 0.0;
      let visibilityCount = 0;

      for (const lm of landmarks) {
        if (lm.visibility === undefined || lm.visibility >= 0.5) {
          visibilityCount++;
        }
        if (lm.x < minX) minX = lm.x;
        if (lm.x > maxX) maxX = lm.x;
        if (lm.y < minY) minY = lm.y;
        if (lm.y > maxY) maxY = lm.y;
      }

      // Add safety margins to bounding box
      const padX = 0.03;
      const padY = 0.03;
      const box = {
        x: Math.max(0, Number((minX - padX).toFixed(3))),
        y: Math.max(0, Number((minY - padY).toFixed(3))),
        width: Math.min(1.0, Number((maxX - minX + 2 * padX).toFixed(3))),
        height: Math.min(1.0, Number((maxY - minY + 2 * padY).toFixed(3)))
      };

      return {
        id: index,
        landmarks,
        torsoCenter,
        boundingBox: box,
        visibilityCount
      };
    });
  }

  destroy() {
    if (this.landmarker) {
      try {
        this.landmarker.close();
      } catch (e) {}
      this.landmarker = null;
    }
    this.isReady = false;
  }
}

export const poseTracker = new PoseTracker();
