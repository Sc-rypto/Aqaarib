/**
 * Input Source Manager
 * /core/inputSource.js
 *
 * Contract: createInputSource({ type: "camera" | "video_file", file, audio })
 * Returns: { video, start(), stop(), isFile, duration }
 */

export function createInputSource({ type = 'camera', file = null, audio = false } = {}) {
  const isBrowser = typeof window !== 'undefined' && typeof document !== 'undefined';
  const isFile = type === 'video_file';

  let videoElement = null;
  let activeStream = null;
  let objectUrl = null;
  let isRunning = false;
  let videoDuration = 0;

  if (isBrowser) {
    videoElement = document.createElement('video');
    videoElement.playsInline = true;
    videoElement.muted = !audio;
    videoElement.autoplay = true;
    videoElement.crossOrigin = 'anonymous';
  } else {
    // Node environment mock for testing
    videoElement = {
      readyState: 4,
      videoWidth: 640,
      videoHeight: 480,
      currentTime: 0,
      duration: 10,
      play: () => Promise.resolve(),
      pause: () => {},
      addEventListener: () => {},
      removeEventListener: () => {}
    };
  }

  return {
    get video() {
      return videoElement;
    },
    get isFile() {
      return isFile;
    },
    get duration() {
      return videoDuration;
    },
    async start() {
      if (isRunning) return videoElement;

      if (!isBrowser) {
        isRunning = true;
        videoDuration = 10;
        return videoElement;
      }

      if (isFile) {
        if (!file) {
          throw new Error('Please select a video file before starting');
        }
        objectUrl = URL.createObjectURL(file);
        videoElement.src = objectUrl;

        await new Promise((resolve, reject) => {
          const onLoaded = () => {
            videoDuration = Number(videoElement.duration.toFixed(1)) || 0;
            videoElement.removeEventListener('loadedmetadata', onLoaded);
            videoElement.removeEventListener('error', onError);
            resolve();
          };
          const onError = (e) => {
            videoElement.removeEventListener('loadedmetadata', onLoaded);
            videoElement.removeEventListener('error', onError);
            reject(new Error('Could not open this video file'));
          };
          videoElement.addEventListener('loadedmetadata', onLoaded);
          videoElement.addEventListener('error', onError);
        });

        try {
          await videoElement.play();
        } catch (_) {
          // Autoplay policy might require host interaction
        }
      } else {
        // Camera mode
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          throw new Error('Camera access is not supported in this browser');
        }

        try {
          activeStream = await navigator.mediaDevices.getUserMedia({
            video: {
              width: { ideal: 1280 },
              height: { ideal: 720 },
              facingMode: 'user'
            },
            audio: Boolean(audio)
          });
        } catch (err) {
          throw new Error('Please allow camera access to join the game');
        }

        videoElement.srcObject = activeStream;

        await new Promise((resolve) => {
          if (videoElement.readyState >= 2) {
            resolve();
            return;
          }
          const onReady = () => {
            videoElement.removeEventListener('loadeddata', onReady);
            resolve();
          };
          videoElement.addEventListener('loadeddata', onReady);
        });

        try {
          await videoElement.play();
        } catch (_) {}
      }

      isRunning = true;
      return videoElement;
    },
    stop() {
      isRunning = false;
      if (!isBrowser) return;

      if (videoElement) {
        try {
          videoElement.pause();
        } catch (_) {}
      }

      if (activeStream) {
        activeStream.getTracks().forEach((track) => {
          try {
            track.stop();
          } catch (_) {}
        });
        activeStream = null;
      }

      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
        objectUrl = null;
      }

      if (videoElement) {
        videoElement.src = '';
        videoElement.srcObject = null;
      }
    }
  };
}
