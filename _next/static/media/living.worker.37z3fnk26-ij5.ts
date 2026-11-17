/**
 * The living background's renderer, on its own thread (see LivingBackground.tsx).
 * It owns an OffscreenCanvas and draws with WebGL2 on the worker's own animation frames,
 * so nothing the interface does on the main thread can delay it, and it costs the main
 * thread nothing per frame.
 *
 * Messages in:  init { canvas }, size { w, h, dpr }, art { bitmap }, run { on }
 * Messages out: drawn (the first frame is on screen), failed { reason }
 */

type In =
  | { type: 'init'; canvas: OffscreenCanvas }
  | { type: 'size'; w: number; h: number; dpr: number }
  | { type: 'art'; bitmap: ImageBitmap }
  | { type: 'run'; on: boolean };

interface Scope {
  postMessage(m: unknown): void;
  onmessage: ((e: MessageEvent<In>) => void) | null;
  requestAnimationFrame(cb: (now: number) => void): number;
  cancelAnimationFrame(id: number): void;
}
const scope = self as unknown as Scope;

/** Canvas pixels drawn per frame, whatever the window size. */
const PIXEL_BUDGET = 1_100_000;
/** Crossfade between two artworks, as long as the still layer's (--t-ambient). */
const CROSSFADE_MS = 1200;

const VERT = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() { vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FRAG = `#version 300 es
precision highp float;
uniform sampler2D uArt0;   // the art on show
uniform sampler2D uArt1;   // the art it replaces, during a crossfade
uniform sampler2D uNoise;  // tileable soft noise, four independent channels
uniform vec4 uFit0;        // object-fit: cover, as uv scale (xy) and offset (zw)
uniform vec4 uFit1;
uniform float uMix;        // 1 = only uArt0
uniform float uTime;       // seconds of motion so far
uniform float uAspect;     // width / height
in vec2 vUv;
out vec4 outColor;

vec2 flow(vec2 q, float t) {
  // two soft fields drifting in different directions: their sum keeps changing shape, like weather
  vec2 a = texture(uNoise, q * 0.42 + vec2(t * 0.0042, t * 0.0013)).xy;
  vec2 b = texture(uNoise, q * 0.9 + vec2(-t * 0.0031, t * 0.0036) + 0.37).zw;
  return (a - 0.5) + (b - 0.5) * 0.6;
}

void main() {
  float t = uTime;
  vec2 q = vec2(vUv.x * uAspect, vUv.y);
  // breathe: a push in and out over 110 s, like the still image's own slow drift
  float b = 0.5 - 0.5 * cos(t * 0.0571);
  vec2 c = (vUv - 0.5) / (1.0 + 0.04 * b) + vec2(0.006, -0.007) * b;
  // the field bends: about 1% of the height, rarely more than 3% (the art has a 3% bleed)
  vec2 d = flow(q, t) * 0.055;
  c += vec2(d.x / uAspect, d.y);
  vec2 uv = vec2(c.x + 0.5, 0.5 - c.y);  // image rows run downwards
  vec3 col = texture(uArt0, uv * uFit0.xy + uFit0.zw).rgb;
  if (uMix < 1.0) col = mix(texture(uArt1, uv * uFit1.xy + uFit1.zw).rgb, col, uMix);
  // light passing over: a broad, faint brightening that drifts with the wind
  float l = texture(uNoise, q * 0.3 + vec2(t * 0.005, -t * 0.0015) + 0.71).x - 0.5;
  col *= 1.0 + 0.09 * l;
  // a little noise below one step of 8 bits, so the gradients never band
  float n = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  outColor = vec4(col + (n - 0.5) * (1.5 / 255.0), 1.0);
}`;

interface Art { tex: WebGLTexture; w: number; h: number }

class Drift {
  private gl: WebGL2RenderingContext;
  private prog: WebGLProgram;
  private u: Record<string, WebGLUniformLocation | null> = {};
  private art: Art | null = null;
  private prev: Art | null = null;
  private fadeFrom = 0;
  private cssW = 1;
  private cssH = 1;

  constructor(private canvas: OffscreenCanvas) {
    const gl = canvas.getContext('webgl2', {
      alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: true,
      preserveDrawingBuffer: false, powerPreference: 'low-power', failIfMajorPerformanceCaveat: true,
    }) as WebGL2RenderingContext | null;
    if (!gl) throw new Error('WebGL2 is not available (or only in software)');
    this.gl = gl;
    const sh = (type: number, text: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, text);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.bindAttribLocation(prog, 0, 'aPos');
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? 'link');
    this.prog = prog;
    gl.useProgram(prog);
    for (const n of ['uArt0', 'uArt1', 'uNoise', 'uFit0', 'uFit1', 'uMix', 'uTime', 'uAspect']) this.u[n] = gl.getUniformLocation(prog, n);
    gl.uniform1i(this.u.uArt0!, 0);
    gl.uniform1i(this.u.uArt1!, 1);
    gl.uniform1i(this.u.uNoise!, 2);

    // one triangle that covers the screen
    gl.bindVertexArray(gl.createVertexArray());
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, NOISE, NOISE, 0, gl.RGBA, gl.UNSIGNED_BYTE, noiseTexture());
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
  }

  private sized = false;
  get ready() { return !!this.art && this.sized; }
  get lost() { return this.gl.isContextLost(); }

  resize(cssW: number, cssH: number, dpr: number) {
    this.cssW = cssW;
    this.cssH = cssH;
    this.sized = true;
    const scale = Math.min(dpr, Math.sqrt(PIXEL_BUDGET / (cssW * cssH)));
    const w = Math.max(1, Math.round(cssW * scale));
    const h = Math.max(1, Math.round(cssH * scale));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  setArt(bmp: ImageBitmap, now: number) {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, bmp);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (this.prev) gl.deleteTexture(this.prev.tex);
    this.prev = this.art;
    this.art = { tex, w: bmp.width, h: bmp.height };
    this.fadeFrom = now;
  }

  /** End any crossfade at once (while held still there is no time to fade). */
  settle() { this.fadeFrom = -Infinity; }

  /** object-fit: cover over a box 6% larger than the canvas, as the still layer does (inset: -3%) */
  private fit(a: Art): [number, number, number, number] {
    const s = Math.max((1.06 * this.cssW) / a.w, (1.06 * this.cssH) / a.h);
    const fx = this.cssW / (a.w * s);
    const fy = this.cssH / (a.h * s);
    return [fx, fy, 0.5 - fx / 2, 0.5 - fy / 2];
  }

  draw(time: number, now: number) {
    const gl = this.gl;
    if (!this.art) return;
    const k = Math.min(1, Math.max(0, (now - this.fadeFrom) / CROSSFADE_MS));
    if (this.prev && k >= 1) { gl.deleteTexture(this.prev.tex); this.prev = null; }
    const f0 = this.fit(this.art);
    const f1 = this.prev ? this.fit(this.prev) : f0;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.uniform4f(this.u.uFit0!, f0[0], f0[1], f0[2], f0[3]);
    gl.uniform4f(this.u.uFit1!, f1[0], f1[1], f1[2], f1[3]);
    gl.uniform1f(this.u.uMix!, this.prev ? k * k * (3 - 2 * k) : 1);
    gl.uniform1f(this.u.uTime!, time);
    gl.uniform1f(this.u.uAspect!, this.cssW / this.cssH);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.art.tex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, (this.prev ?? this.art).tex);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}

// ── tileable soft noise ──────────────────────────────────────────────────────

const NOISE = 128;

/** Four channels of periodic value noise (two octaves, quintic smoothing), centred on 0.5, made once. */
function noiseTexture(): Uint8Array {
  const out = new Uint8Array(NOISE * NOISE * 4);
  let seed = 0x2545f491;
  const rand = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const fade = (x: number) => x * x * x * (x * (x * 6 - 15) + 10);
  for (let c = 0; c < 4; c++) {
    const field = new Float32Array(NOISE * NOISE);
    for (const [cells, amp] of [[4, 1], [8, 0.45]] as const) {
      const lattice = Array.from({ length: cells * cells }, rand);
      const at = (x: number, y: number) => lattice[(y % cells) * cells + (x % cells)]!;
      for (let y = 0; y < NOISE; y++) {
        const gy = (y / NOISE) * cells;
        const y0 = Math.floor(gy);
        const fy = fade(gy - y0);
        for (let x = 0; x < NOISE; x++) {
          const gx = (x / NOISE) * cells;
          const x0 = Math.floor(gx);
          const fx = fade(gx - x0);
          const top = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * fx;
          const bottom = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * fx;
          field[y * NOISE + x] = field[y * NOISE + x]! + (top + (bottom - top) * fy) * amp;
        }
      }
    }
    let mean = 0;
    for (const v of field) mean += v;
    mean /= field.length;
    let sd = 0;
    for (const v of field) sd += (v - mean) ** 2;
    sd = Math.sqrt(sd / field.length) || 1;
    for (let i = 0; i < field.length; i++) out[i * 4 + c] = Math.max(0, Math.min(255, Math.round((0.5 + ((field[i]! - mean) / sd) * 0.16) * 255)));
  }
  return out;
}

// ── the loop ─────────────────────────────────────────────────────────────────

let engine: Drift | null = null;
let running = false;
let raf = 0;
let last = 0;
let time = 0;
let drawn = false;

const fail = (reason: unknown) => {
  running = false;
  if (raf) { scope.cancelAnimationFrame(raf); raf = 0; }
  scope.postMessage({ type: 'failed', reason: String(reason instanceof Error ? reason.message : reason) });
};

const draw = () => {
  if (!engine) return;
  if (engine.lost) { fail('the WebGL context was lost'); return; }
  engine.draw(time, performance.now());
  if (!drawn) { drawn = true; scope.postMessage({ type: 'drawn' }); }
};

const frame = (now: number) => {
  raf = 0;
  if (!running || !engine?.ready) return;
  time += Math.min(now - last, 100) / 1000; // after a stall the weather carries on, it does not jump
  last = now;
  draw();
  raf = scope.requestAnimationFrame(frame);
};

/** Held still, a new image or a new size is still shown once, without a crossfade. */
const showOnce = () => {
  if (running || !engine?.ready) return;
  engine.settle();
  draw();
};

const start = () => {
  if (!running || raf || !engine?.ready) return;
  last = performance.now();
  raf = scope.requestAnimationFrame(frame);
};

scope.onmessage = (e) => {
  const m = e.data;
  try {
    if (m.type === 'init') {
      engine = new Drift(m.canvas);
    } else if (!engine) {
      if (m.type === 'art') m.bitmap.close();
    } else if (m.type === 'size') {
      engine.resize(m.w, m.h, m.dpr);
      showOnce();
      start();
    } else if (m.type === 'art') {
      engine.setArt(m.bitmap, performance.now());
      m.bitmap.close();
      showOnce();
      start();
    } else if (m.type === 'run') {
      running = m.on;
      if (running) start();
      else if (raf) { scope.cancelAnimationFrame(raf); raf = 0; }
    }
  } catch (err) {
    fail(err);
  }
};
