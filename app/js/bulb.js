// A clear incandescent lamp hanging from its cord. The only animated quantity is
// the filament temperature, which follows the data with a short thermal lag.
// Colour and brightness come from black-body radiation at that temperature.
import {
  blackbody,
  levelToTemperature,
  wireBrightness,
  glowStrength,
  T_IDLE,
} from "./tungsten.js";

// Scene units: x = 0 on the lamp axis, y = 0 at the top of the socket.
const GLASS_TOP = 146,
  GLASS_BOTTOM = 472,
  SCENE_WIDTH = 262,
  FILAMENT = { x: 0, y: 338 };
// Half-width of the glass envelope at depth y (A-shape, hanging neck-up).
const PROFILE = [
  [24, 146],
  [25.5, 160],
  [28, 176],
  [37, 194],
  [57, 214],
  [84, 236],
  [105, 260],
  [119, 288],
  [126.5, 318],
  [128.5, 345],
  [125.5, 375],
  [116, 403],
  [99.5, 428],
  [75, 450],
  [42, 466],
  [0, 472],
];
function catmull(points, samples = 10) {
  const out = [];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)],
      p1 = points[i],
      p2 = points[i + 1],
      p3 = points[Math.min(points.length - 1, i + 2)];
    for (let k = 0; k < samples; k++) {
      const t = k / samples,
        t2 = t * t,
        t3 = t2 * t;
      out.push([
        0.5 *
          (2 * p1[0] +
            (-p0[0] + p2[0]) * t +
            (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 +
            (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        0.5 *
          (2 * p1[1] +
            (-p0[1] + p2[1]) * t +
            (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 +
            (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
      ]);
    }
  }
  out.push(points.at(-1));
  return out;
}
function glassPath() {
  const right = catmull(PROFILE, 12),
    path = new Path2D();
  path.moveTo(-right[0][0], right[0][1]);
  for (const [x, y] of right) path.lineTo(-x, y);
  for (let i = right.length - 1; i >= 0; i--) path.lineTo(right[i][0], right[i][1]);
  path.closePath();
  return path;
}
// The filament axis: a shallow sag between the two lead-in wires.
const AXIS = catmull(
  [
    [-50, 326],
    [-35, 335.5],
    [-22, 340.5],
    [0, 343],
    [22, 340.5],
    [35, 335.5],
    [50, 326],
  ],
  16,
);
function resample(points, step) {
  const out = [points[0]];
  let carry = 0;
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1],
      [x1, y1] = points[i],
      len = Math.hypot(x1 - x0, y1 - y0);
    let d = step - carry;
    while (d <= len) {
      out.push([x0 + ((x1 - x0) * d) / len, y0 + ((y1 - y0) * d) / len]);
      d += step;
    }
    carry = len - (d - step);
  }
  return out;
}
function axisPath() {
  const p = new Path2D();
  AXIS.forEach(([x, y], i) => (i ? p.lineTo(x, y) : p.moveTo(x, y)));
  return p;
}
// A coiled wire along the axis, seen from the side: each turn is a small loop.
function coilPath(radius = 3.9, pitch = 3.3) {
  const pts = resample(AXIS, pitch / 22),
    path = new Path2D();
  pts.forEach((p, i) => {
    const q = pts[Math.min(pts.length - 1, i + 1)],
      r = pts[Math.max(0, i - 1)],
      tx = q[0] - r[0],
      ty = q[1] - r[1],
      len = Math.hypot(tx, ty) || 1,
      ux = tx / len,
      uy = ty / len,
      theta = (i / 22) * Math.PI * 2,
      along = radius * 0.42 * Math.cos(theta),
      across = radius * Math.sin(theta),
      x = p[0] + ux * along - uy * across,
      y = p[1] + uy * along + ux * across;
    i ? path.lineTo(x, y) : path.moveTo(x, y);
  });
  return path;
}
function stemPath() {
  const p = new Path2D();
  // Flared glass stem from the neck, narrowing into the flattened press.
  p.moveTo(-17, 150);
  p.bezierCurveTo(-15, 170, -7, 182, -6.5, 206);
  p.lineTo(-12, 212);
  p.lineTo(-12, 236);
  p.quadraticCurveTo(-12, 240, -8, 240);
  p.lineTo(8, 240);
  p.quadraticCurveTo(12, 240, 12, 236);
  p.lineTo(12, 212);
  p.lineTo(6.5, 206);
  p.bezierCurveTo(7, 182, 15, 170, 17, 150);
  p.closePath();
  return p;
}
function wirePaths() {
  const leads = new Path2D();
  leads.moveTo(-5, 238);
  leads.bezierCurveTo(-8, 262, -40, 296, -50, 326);
  leads.moveTo(5, 238);
  leads.bezierCurveTo(8, 262, 40, 296, 50, 326);
  const rod = new Path2D();
  rod.moveTo(0, 240);
  rod.lineTo(0, 292);
  const supports = new Path2D();
  supports.moveTo(0, 294);
  supports.quadraticCurveTo(-14, 312, -22, 337);
  supports.moveTo(0, 294);
  supports.quadraticCurveTo(14, 312, 22, 337);
  return { leads, rod, supports };
}
const rgba = (c, a) =>
  `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${Math.max(0, Math.min(1, a)).toFixed(4)})`;
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

export function createBulb(host, options = {}) {
  const o = {
    glassBottom: 0.9,
    height: 0.62,
    width: 0.72,
    centerX: 0.5,
    light: host,
    ...options,
  };
  host.classList.add("lamp");
  host.setAttribute("role", "img");
  host.setAttribute("aria-label", options.label || "Light bulb");
  const canvas = document.createElement("canvas");
  canvas.className = "lamp-canvas";
  canvas.setAttribute("aria-hidden", "true");
  host.prepend(canvas);
  const ctx = canvas.getContext("2d");
  const glass = glassPath(),
    axis = axisPath(),
    coil = coilPath(),
    stem = stemPath(),
    wires = wirePaths();
  let width = 0,
    height = 0,
    dpr = 1,
    scale = 1,
    ox = 0,
    oy = 0,
    T = T_IDLE,
    target = T_IDLE,
    frame = 0,
    last = 0,
    lastDraw = 0,
    destroyed = false;

  function layout() {
    const r = host.getBoundingClientRect();
    width = Math.max(1, r.width);
    height = Math.max(1, r.height);
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    scale = Math.min(
      (height * o.height) / GLASS_BOTTOM,
      (width * o.width) / SCENE_WIDTH,
    );
    ox = width * o.centerX;
    oy = height * o.glassBottom - GLASS_BOTTOM * scale;
    draw();
  }

  function drawCord(top) {
    const w = 7.5,
      grad = ctx.createLinearGradient(-w / 2, 0, w / 2, 0);
    grad.addColorStop(0, "#0b0907");
    grad.addColorStop(0.32, "#2b231d");
    grad.addColorStop(0.55, "#1a1410");
    grad.addColorStop(1, "#090705");
    ctx.fillStyle = grad;
    ctx.fillRect(-w / 2, top, w, -top + 4);
    ctx.strokeStyle = "rgba(255,236,214,0.045)";
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    for (let y = 2; y > top; y -= 3) {
      ctx.moveTo(-w / 2, y);
      ctx.lineTo(w / 2, y - 2.6);
    }
    ctx.stroke();
    // The cord rises out of darkness rather than ending at the frame edge.
    if (o.fadeCord) {
      ctx.save();
      ctx.globalCompositeOperation = "destination-out";
      const fade = ctx.createLinearGradient(0, top, 0, top + 150);
      fade.addColorStop(0, "rgba(0,0,0,1)");
      fade.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = fade;
      ctx.fillRect(-w, top - 2, w * 2, 154);
      ctx.restore();
    }
  }

  function metalGradient(x0, x1, dark, mid, bright) {
    const g = ctx.createLinearGradient(x0, 0, x1, 0);
    g.addColorStop(0, dark);
    g.addColorStop(0.24, mid);
    g.addColorStop(0.36, bright);
    g.addColorStop(0.52, mid);
    g.addColorStop(0.8, dark);
    g.addColorStop(0.93, mid);
    g.addColorStop(1, dark);
    return g;
  }

  // Warm light from the lamp below falls on the underside of the metalwork.
  function underlight(path, y0, y1, color, strength) {
    if (strength <= 0.002) return;
    ctx.save();
    ctx.clip(path);
    ctx.globalCompositeOperation = "lighter";
    const g = ctx.createLinearGradient(0, y1, 0, y0);
    g.addColorStop(0, rgba(color, strength));
    g.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = g;
    ctx.fillRect(-60, y0, 120, y1 - y0);
    ctx.restore();
  }

  function drawSocket(color, light) {
    const cap = new Path2D();
    cap.roundRect(-16, -2, 32, 18, [3, 3, 2, 2]);
    ctx.fillStyle = metalGradient(-16, 16, "#1b140c", "#4a3820", "#86683d");
    ctx.fill(cap);
    const body = new Path2D();
    body.moveTo(-28, 14);
    body.lineTo(28, 14);
    body.lineTo(31, 96);
    body.lineTo(-31, 96);
    body.closePath();
    ctx.fillStyle = metalGradient(-31, 31, "#1d150c", "#4f3c22", "#94743f");
    ctx.fill(body);
    ctx.strokeStyle = "rgba(0,0,0,0.45)";
    ctx.lineWidth = 1.2;
    for (const y of [27, 86]) {
      ctx.beginPath();
      ctx.moveTo(-29, y);
      ctx.lineTo(29, y);
      ctx.stroke();
    }
    ctx.strokeStyle = "rgba(255,226,180,0.07)";
    for (const y of [28.4, 87.4]) {
      ctx.beginPath();
      ctx.moveTo(-29, y);
      ctx.lineTo(29, y);
      ctx.stroke();
    }
    const rim = new Path2D();
    rim.roundRect(-34.5, 92, 69, 13, 3);
    ctx.fillStyle = metalGradient(-34.5, 34.5, "#1a130b", "#55412a", "#9c7b45");
    ctx.fill(rim);
    underlight(body, 40, 96, color, 0.2 * light);
    underlight(rim, 92, 105, color, 0.55 * light);
  }

  function drawThreads(color, light) {
    const shell = new Path2D();
    shell.rect(-26.5, 104, 53, 46);
    ctx.save();
    ctx.clip(shell);
    ctx.fillStyle = metalGradient(-26.5, 26.5, "#1f1f1e", "#5b5a57", "#a4a29c");
    ctx.fillRect(-27, 104, 54, 47);
    for (let y = 106; y < 152; y += 10.5) {
      ctx.beginPath();
      ctx.ellipse(0, y + 5, 27.5, 2.6, -0.05, 0, Math.PI);
      ctx.strokeStyle = "rgba(0,0,0,0.55)";
      ctx.lineWidth = 3.6;
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(0, y + 7.6, 27.5, 2.6, -0.05, 0, Math.PI);
      ctx.strokeStyle = "rgba(255,255,255,0.10)";
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
    ctx.restore();
    underlight(shell, 112, 150, color, 0.5 * light);
  }

  function draw() {
    if (destroyed) return;
    const { rgb, L } = blackbody(T),
      wire = wireBrightness(T),
      glow = glowStrength(L),
      lit = Math.min(1, glow);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * ox, dpr * oy);
    const fx = FILAMENT.x,
      fy = FILAMENT.y;

    // Light thrown into the room behind the lamp.
    if (glow > 0.003) {
      const bloom = ctx.createRadialGradient(fx, fy, 0, fx, fy, 360);
      bloom.addColorStop(0, rgba(rgb, 0.3 * lit));
      bloom.addColorStop(0.22, rgba(rgb, 0.12 * lit));
      bloom.addColorStop(0.55, rgba(rgb, 0.035 * lit));
      bloom.addColorStop(1, rgba(rgb, 0));
      ctx.fillStyle = bloom;
      ctx.fillRect(-420, -oy / scale - 10, 840, 1000 + oy / scale);
    }

    drawCord(-oy / scale - 4);

    // Light scattered inside the envelope.
    ctx.save();
    ctx.clip(glass);
    ctx.fillStyle = "rgba(200,214,232,0.018)";
    ctx.fill(glass);
    ctx.globalCompositeOperation = "lighter";
    if (glow > 0.002) {
      const inner = ctx.createRadialGradient(fx, fy, 2, fx, fy + 10, 160);
      inner.addColorStop(0, rgba(rgb, 0.26 * lit));
      inner.addColorStop(0.35, rgba(rgb, 0.09 * lit));
      inner.addColorStop(1, rgba(rgb, 0.025 * lit));
      ctx.fillStyle = inner;
      ctx.fill(glass);
    }
    ctx.restore();

    // Glass stem and press, lit from the filament below.
    ctx.fillStyle = "rgba(205,218,236,0.045)";
    ctx.fill(stem);
    ctx.strokeStyle = "rgba(214,226,242,0.13)";
    ctx.lineWidth = 0.9;
    ctx.stroke(stem);
    if (glow > 0.002) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.strokeStyle = rgba(rgb, 0.35 * lit);
      ctx.stroke(stem);
      ctx.restore();
    }
    ctx.strokeStyle = "rgba(214,226,242,0.12)";
    ctx.lineWidth = 2.2;
    ctx.stroke(wires.rod);
    ctx.beginPath();
    ctx.arc(0, 294, 3.6, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(214,226,242,0.16)";
    ctx.fill();

    // Lead-in and support wires: dark metal with reflected light.
    ctx.lineCap = "round";
    ctx.strokeStyle = "#3b322b";
    ctx.lineWidth = 1.5;
    ctx.stroke(wires.leads);
    ctx.lineWidth = 0.8;
    ctx.stroke(wires.supports);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const shine = Math.min(1, 0.06 + 0.9 * lit + 0.25 * wire);
    ctx.strokeStyle = rgba(mix([150, 128, 108], rgb, Math.min(1, wire * 1.4)), 0.5 * shine);
    ctx.lineWidth = 1.1;
    ctx.stroke(wires.leads);
    ctx.lineWidth = 0.6;
    ctx.stroke(wires.supports);
    ctx.restore();

    // The filament: cold metal underneath, emission on top.
    ctx.lineJoin = "round";
    ctx.strokeStyle = "rgba(92,84,77,0.9)";
    ctx.lineWidth = 1.15;
    ctx.stroke(coil);
    if (wire > 0.004) {
      const core = mix(rgb, [255, 250, 240], Math.max(0, Math.min(0.85, (wire - 0.72) * 2.4))),
        w = Math.min(1, wire);
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      // Close glow around the coil.
      ctx.save();
      ctx.translate(fx, fy - 5);
      ctx.scale(1, 0.42);
      const halo = ctx.createRadialGradient(0, 0, 0, 0, 0, 78);
      halo.addColorStop(0, rgba(rgb, 0.5 * w * w));
      halo.addColorStop(0.45, rgba(rgb, 0.16 * w * w));
      halo.addColorStop(1, rgba(rgb, 0));
      ctx.fillStyle = halo;
      ctx.fillRect(-80, -80, 160, 160);
      ctx.restore();
      ctx.shadowColor = rgba(rgb, 0.9 * w);
      ctx.shadowBlur = (3 + 17 * w) * scale * dpr;
      ctx.strokeStyle = rgba(rgb, 0.5 * w * w);
      ctx.lineWidth = 7.4;
      ctx.stroke(axis);
      ctx.shadowBlur = 0;
      ctx.strokeStyle = rgba(core.map((v) => v * w), 1);
      ctx.lineWidth = 1.25;
      ctx.stroke(coil);
      if (wire > 0.85) {
        ctx.strokeStyle = rgba([255, 252, 246], Math.min(1, (wire - 0.85) * 2.2));
        ctx.lineWidth = 3.2;
        ctx.stroke(axis);
      }
      ctx.restore();
    }

    // The envelope: cool edge reflections from the room, warm light from inside.
    ctx.save();
    ctx.clip(glass);
    ctx.strokeStyle = "rgba(190,206,228,0.05)";
    ctx.lineWidth = 16;
    ctx.stroke(glass);
    if (glow > 0.002) {
      ctx.globalCompositeOperation = "lighter";
      ctx.strokeStyle = rgba(rgb, 0.1 * lit);
      ctx.lineWidth = 22;
      ctx.stroke(glass);
      const reflection = ctx.createRadialGradient(0, 457, 0, 0, 457, 34);
      reflection.addColorStop(0, rgba(rgb, 0.4 * lit));
      reflection.addColorStop(1, rgba(rgb, 0));
      ctx.fillStyle = reflection;
      ctx.fillRect(-40, 420, 80, 60);
    }
    ctx.restore();
    ctx.strokeStyle = "rgba(208,222,240,0.2)";
    ctx.lineWidth = 1.1;
    ctx.stroke(glass);
    if (glow > 0.002) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.strokeStyle = rgba(rgb, 0.36 * lit);
      ctx.lineWidth = 1.6;
      ctx.stroke(glass);
      ctx.restore();
    }
    // Window reflections on the curved glass.
    ctx.save();
    ctx.lineCap = "round";
    ctx.filter = `blur(${(2.2 * scale * dpr).toFixed(2)}px)`;
    ctx.strokeStyle = "rgba(232,240,252,0.16)";
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.arc(0, 342, 108, Math.PI * 1.08, Math.PI * 1.33);
    ctx.stroke();
    ctx.strokeStyle = "rgba(232,240,252,0.07)";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(0, 342, 114, -0.2, 0.26);
    ctx.stroke();
    ctx.restore();
    ctx.beginPath();
    ctx.ellipse(-80, 268, 3.2, 1.8, -0.75, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.42)";
    ctx.fill();

    drawThreads(rgb, lit);
    drawSocket(rgb, lit);

    // Glare: what a very bright filament does to the eye.
    if (glow > 0.3) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      const g = Math.min(1.5, glow - 0.3),
        glare = ctx.createRadialGradient(fx, fy - 2, 0, fx, fy, 200);
      glare.addColorStop(0, rgba(mix(rgb, [255, 249, 240], 0.7), 0.7 * g));
      glare.addColorStop(0.08, rgba(mix(rgb, [255, 249, 240], 0.4), 0.32 * g));
      glare.addColorStop(0.3, rgba(rgb, 0.1 * g));
      glare.addColorStop(1, rgba(rgb, 0));
      ctx.fillStyle = glare;
      ctx.fillRect(fx - 210, fy - 210, 420, 420);
      ctx.restore();
    }
    const target = o.light;
    if (target) {
      target.style.setProperty("--lamp", rgb.map(Math.round).join(" "));
      target.style.setProperty("--lamp-glow", Math.min(1.5, glow).toFixed(4));
      target.style.setProperty(
        "--lamp-y",
        ((oy + fy * scale) / height) * 100 + "%",
      );
    }
  }

  function tick(time) {
    const dt = last ? Math.min(0.1, (time - last) / 1000) : 1 / 60;
    last = time;
    const tau = target > T ? 0.32 : 0.6;
    T += (target - T) * (1 - Math.exp(-dt / tau));
    if (Math.abs(target - T) < 0.6) T = target;
    // About 30 frames a second is plenty for a thermal glow and halves the work
    // of a full-screen canvas over long sessions.
    if (T === target || time - lastDraw >= 32) {
      draw();
      lastDraw = time;
    }
    if (T !== target) frame = requestAnimationFrame(tick);
    else {
      frame = 0;
      last = 0;
    }
  }

  const observer = new ResizeObserver(layout);
  observer.observe(host);
  layout();
  return {
    set(level, label) {
      target = levelToTemperature(level ?? 0);
      if (label) host.setAttribute("aria-label", label);
      if (!frame && T !== target) frame = requestAnimationFrame(tick);
    },
    // Jump straight to a level (used when a view first opens).
    snap(level) {
      target = T = levelToTemperature(level ?? 0);
      draw();
    },
    get temperature() {
      return T;
    },
    destroy() {
      destroyed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      canvas.remove();
    },
  };
}
