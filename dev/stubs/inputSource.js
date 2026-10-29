/**
 * Aqaarib Media Engine - Video & Camera Input Source
 */

export class InputSource {
  constructor() {
    this.videoElement = null;
    this.stream = null;
    this.isCamera = false;
    this.isVideoFile = false;
  }

  async startCamera(constraints = { video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' } }) {
    this.stop();

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('Camera access not supported by this browser environment');
    }

    this.stream = await navigator.mediaDevices.getUserMedia(constraints);

    if (!this.videoElement) {
      this.videoElement = document.createElement('video');
      this.videoElement.playsInline = true;
      this.videoElement.muted = true;
      this.videoElement.autoplay = true;
    }

    this.videoElement.srcObject = this.stream;
    await new Promise((resolve) => {
      this.videoElement.onloadedmetadata = () => {
        this.videoElement.play().then(resolve).catch(resolve);
      };
    });

    this.isCamera = true;
    this.isVideoFile = false;
    return this.videoElement;
  }

  async loadVideoFile(source) {
    this.stop();

    if (!this.videoElement) {
      this.videoElement = document.createElement('video');
      this.videoElement.playsInline = true;
      this.videoElement.muted = true;
    }

    const srcUrl = typeof source === 'string' ? source : URL.createObjectURL(source);
    this.videoElement.srcObject = null;
    this.videoElement.src = srcUrl;

    await new Promise((resolve, reject) => {
      this.videoElement.onloadedmetadata = () => resolve(this.videoElement);
      this.videoElement.onerror = (e) => reject(new Error('Failed to load video file: ' + e));
    });

    this.isCamera = false;
    this.isVideoFile = true;
    return this.videoElement;
  }

  getVideoElement() {
    return this.videoElement;
  }

  getDimensions() {
    if (!this.videoElement) return { width: 640, height: 480 };
    return {
      width: this.videoElement.videoWidth || 640,
      height: this.videoElement.videoHeight || 480
    };
  }

  isReady() {
    return Boolean(
      this.videoElement &&
      this.videoElement.readyState >= 2 &&
      this.videoElement.videoWidth > 0
    );
  }

  captureFrameToCanvas(targetWidth = 320, targetHeight = 240) {
    if (!this.isReady()) return null;
    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(this.videoElement, 0, 0, targetWidth, targetHeight);
    return canvas;
  }

  stop() {
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
    if (this.videoElement) {
      this.videoElement.pause();
      if (this.videoElement.src) {
        URL.revokeObjectURL(this.videoElement.src);
        this.videoElement.removeAttribute('src');
      }
      this.videoElement.srcObject = null;
    }
    this.isCamera = false;
    this.isVideoFile = false;
  }
}

export const inputSource = new InputSource();
