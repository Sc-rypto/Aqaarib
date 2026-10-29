/**
 * Application Configuration and Pinned Third-Party Dependencies
 * /core/config.js
 */

export const CONFIG = {
  // MediaPipe Tasks Vision (pinned version 0.10.14)
  MEDIAPIPE_VISION_BUNDLE: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs',
  MEDIAPIPE_WASM_BASE: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm',
  MEDIAPIPE_POSE_MODEL: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',

  // Vladimir Mandic Human (pinned version 3.2.2)
  HUMAN_ESM_URL: 'https://cdn.jsdelivr.net/npm/@vladmandic/human@3.2.2/dist/human.esm.js',
  HUMAN_MODELS_BASE: 'https://cdn.jsdelivr.net/npm/@vladmandic/human@3.2.2/models',

  // App Metadata
  APP_NAME: 'Family AI Game Day',
  SCHEMA_VERSION: 'majlis-result/1',
  MAX_EVIDENCE_ITEMS: 12,
  MAX_EVIDENCE_WIDTH: 640,
  JPEG_QUALITY: 0.7
};
