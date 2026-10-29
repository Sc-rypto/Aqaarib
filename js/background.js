/**
 * Aqaarib Ambient Hearth Canvas
 * Dotted line matrix with cursor proximity illumination and gentle click ripples.
 * Strictly non-intrusive: pointer-events none, rendered behind content, suppressed over interactive UI.
 */

(function() {
  const canvas = document.getElementById('bg-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  
  let width = 0;
  let height = 0;
  let dpr = 1;
  const spacing = 20;
  const baseRadius = 0.85;
  const hoverRadius = 1.25;
  const maxProximity = 90;
  
  let mouse = { x: -9999, y: -9999, active: false };
  let ripples = [];

  function isOverInteractive(el) {
    if (!el) return false;
    return Boolean(el.closest('button, a, input, select, textarea, [role="button"], label, .kinship-card, .modal-content, .floating-dock, .camera-viewport-wrap, .polaroid-card'));
  }

  function resize() {
    dpr = window.devicePixelRatio || 1;
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  
  window.addEventListener('resize', resize);
  resize();
  
  window.addEventListener('pointermove', function(e) {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (isOverInteractive(el)) {
      mouse.active = false;
      mouse.x = -9999;
      mouse.y = -9999;
    } else {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
      mouse.active = true;
    }
  });
  
  window.addEventListener('pointerleave', function() {
    mouse.active = false;
    mouse.x = -9999;
    mouse.y = -9999;
  });
  
  window.addEventListener('click', function(e) {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (isOverInteractive(el)) return;

    ripples.push({
      x: e.clientX,
      y: e.clientY,
      radius: 0,
      maxRadius: 220,
      opacity: 0.22,
      speed: 1.6,
      lineWidth: 1.2,
      decay: 0.0038,
      color: 'rgba(224, 109, 83, '
    });
  });

  function draw() {
    ctx.clearRect(0, 0, width, height);

    // Update ripples
    for (let i = ripples.length - 1; i >= 0; i--) {
      const r = ripples[i];
      r.radius += r.speed;
      r.opacity -= r.decay;
      
      if (r.opacity <= 0 || r.radius >= r.maxRadius) {
        ripples.splice(i, 1);
        continue;
      }
      
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.radius, 0, Math.PI * 2);
      ctx.strokeStyle = r.color + Math.max(0, r.opacity) + ')';
      ctx.lineWidth = r.lineWidth;
      ctx.stroke();
    }
    
    // Draw matrix dots
    const cols = Math.ceil(width / spacing) + 1;
    const rows = Math.ceil(height / spacing) + 1;
    const startX = (width % spacing) / 2;
    const startY = (height % spacing) / 2;
    
    for (let c = 0; c < cols; c++) {
      for (let row = 0; row < rows; row++) {
        const x = startX + c * spacing;
        const y = startY + row * spacing;
        
        let distToMouse = 9999;
        if (mouse.active) {
          const dx = mouse.x - x;
          const dy = mouse.y - y;
          distToMouse = Math.hypot(dx, dy);
        }
        
        let rippleBonus = 0;
        for (let j = 0; j < ripples.length; j++) {
          const rip = ripples[j];
          const dR = Math.hypot(rip.x - x, rip.y - y);
          const diff = Math.abs(dR - rip.radius);
          if (diff < 22) {
            rippleBonus = Math.max(rippleBonus, (1 - diff / 22) * rip.opacity);
          }
        }
        
        let radius = baseRadius;
        let opacity = 0.065;
        
        if (distToMouse < maxProximity) {
          const factor = 1 - (distToMouse / maxProximity);
          radius = baseRadius + (hoverRadius - baseRadius) * factor;
          opacity = 0.065 + 0.18 * factor;
        }
        
        if (rippleBonus > 0) {
          opacity = Math.min(0.28, opacity + rippleBonus * 0.25);
          radius = Math.min(1.3, radius + rippleBonus * 0.35);
        }
        
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(224, 109, 83, ' + opacity + ')';
        ctx.fill();
      }
    }
    
    requestAnimationFrame(draw);
  }
  
  requestAnimationFrame(draw);
})();
