(globalThis.TURBOPACK||(globalThis.TURBOPACK=[])).push(["object"==typeof document?document.currentScript:void 0,97546,t=>{"use strict";let e=self,r=`#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() { vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`,i=`#version 300 es
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
}`;class a{canvas;gl;prog;u;art;prev;fadeFrom;cssW;cssH;constructor(t){this.canvas=t,this.u={},this.art=null,this.prev=null,this.fadeFrom=0,this.cssW=1,this.cssH=1,this.sized=!1;let e=t.getContext("webgl2",{alpha:!1,antialias:!1,depth:!1,stencil:!1,premultipliedAlpha:!0,preserveDrawingBuffer:!1,powerPreference:"low-power",failIfMajorPerformanceCaveat:!0});if(!e)throw Error("WebGL2 is not available (or only in software)");this.gl=e;let a=(t,r)=>{let i=e.createShader(t);if(e.shaderSource(i,r),e.compileShader(i),!e.getShaderParameter(i,e.COMPILE_STATUS))throw Error(e.getShaderInfoLog(i)??"shader");return i},o=e.createProgram();if(e.attachShader(o,a(e.VERTEX_SHADER,r)),e.attachShader(o,a(e.FRAGMENT_SHADER,i)),e.bindAttribLocation(o,0,"aPos"),e.linkProgram(o),!e.getProgramParameter(o,e.LINK_STATUS))throw Error(e.getProgramInfoLog(o)??"link");for(let t of(this.prog=o,e.useProgram(o),["uArt0","uArt1","uNoise","uFit0","uFit1","uMix","uTime","uAspect"]))this.u[t]=e.getUniformLocation(o,t);e.uniform1i(this.u.uArt0,0),e.uniform1i(this.u.uArt1,1),e.uniform1i(this.u.uNoise,2),e.bindVertexArray(e.createVertexArray()),e.bindBuffer(e.ARRAY_BUFFER,e.createBuffer()),e.bufferData(e.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),e.STATIC_DRAW),e.enableVertexAttribArray(0),e.vertexAttribPointer(0,2,e.FLOAT,!1,0,0),e.activeTexture(e.TEXTURE2),e.bindTexture(e.TEXTURE_2D,e.createTexture()),e.texImage2D(e.TEXTURE_2D,0,e.RGBA8,s,s,0,e.RGBA,e.UNSIGNED_BYTE,function(){let t=new Uint8Array(s*s*4),e=0x2545f491,r=()=>{let t=Math.imul((e=e+0x6d2b79f5|0)^e>>>15,1|e);return(((t=t+Math.imul(t^t>>>7,61|t)^t)^t>>>14)>>>0)/0x100000000},i=t=>t*t*t*(t*(6*t-15)+10);for(let e=0;e<4;e++){let a=new Float32Array(s*s);for(let[t,e]of[[4,1],[8,.45]]){let o=Array.from({length:t*t},r),n=(e,r)=>o[r%t*t+e%t];for(let r=0;r<s;r++){let o=r/s*t,h=Math.floor(o),u=i(o-h);for(let o=0;o<s;o++){let l=o/s*t,c=Math.floor(l),f=i(l-c),T=n(c,h)+(n(c+1,h)-n(c,h))*f,m=n(c,h+1)+(n(c+1,h+1)-n(c,h+1))*f;a[r*s+o]=a[r*s+o]+(T+(m-T)*u)*e}}}let o=0;for(let t of a)o+=t;o/=a.length;let n=0;for(let t of a)n+=(t-o)**2;n=Math.sqrt(n/a.length)||1;for(let r=0;r<a.length;r++)t[4*r+e]=Math.max(0,Math.min(255,Math.round((.5+(a[r]-o)/n*.16)*255)))}return t}()),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MIN_FILTER,e.LINEAR),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MAG_FILTER,e.LINEAR),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_S,e.REPEAT),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_T,e.REPEAT)}sized;get ready(){return!!this.art&&this.sized}get lost(){return this.gl.isContextLost()}resize(t,e,r){this.cssW=t,this.cssH=e,this.sized=!0;let i=Math.min(r,Math.sqrt(11e5/(t*e))),a=Math.max(1,Math.round(t*i)),s=Math.max(1,Math.round(e*i));(this.canvas.width!==a||this.canvas.height!==s)&&(this.canvas.width=a,this.canvas.height=s)}setArt(t,e){let r=this.gl,i=r.createTexture();r.activeTexture(r.TEXTURE3),r.bindTexture(r.TEXTURE_2D,i),r.texImage2D(r.TEXTURE_2D,0,r.RGBA8,r.RGBA,r.UNSIGNED_BYTE,t),r.generateMipmap(r.TEXTURE_2D),r.texParameteri(r.TEXTURE_2D,r.TEXTURE_MIN_FILTER,r.LINEAR_MIPMAP_LINEAR),r.texParameteri(r.TEXTURE_2D,r.TEXTURE_MAG_FILTER,r.LINEAR),r.texParameteri(r.TEXTURE_2D,r.TEXTURE_WRAP_S,r.CLAMP_TO_EDGE),r.texParameteri(r.TEXTURE_2D,r.TEXTURE_WRAP_T,r.CLAMP_TO_EDGE),this.prev&&r.deleteTexture(this.prev.tex),this.prev=this.art,this.art={tex:i,w:t.width,h:t.height},this.fadeFrom=e}settle(){this.fadeFrom=-1/0}fit(t){let e=Math.max(1.06*this.cssW/t.w,1.06*this.cssH/t.h),r=this.cssW/(t.w*e),i=this.cssH/(t.h*e);return[r,i,.5-r/2,.5-i/2]}draw(t,e){let r=this.gl;if(!this.art)return;let i=Math.min(1,Math.max(0,(e-this.fadeFrom)/1200));this.prev&&i>=1&&(r.deleteTexture(this.prev.tex),this.prev=null);let a=this.fit(this.art),s=this.prev?this.fit(this.prev):a;r.viewport(0,0,this.canvas.width,this.canvas.height),r.uniform4f(this.u.uFit0,a[0],a[1],a[2],a[3]),r.uniform4f(this.u.uFit1,s[0],s[1],s[2],s[3]),r.uniform1f(this.u.uMix,this.prev?i*i*(3-2*i):1),r.uniform1f(this.u.uTime,t),r.uniform1f(this.u.uAspect,this.cssW/this.cssH),r.activeTexture(r.TEXTURE0),r.bindTexture(r.TEXTURE_2D,this.art.tex),r.activeTexture(r.TEXTURE1),r.bindTexture(r.TEXTURE_2D,(this.prev??this.art).tex),r.drawArrays(r.TRIANGLES,0,3)}}let s=128,o=null,n=!1,h=0,u=0,l=0,c=!1,f=t=>{n=!1,h&&(e.cancelAnimationFrame(h),h=0),e.postMessage({type:"failed",reason:String(t instanceof Error?t.message:t)})},T=()=>{if(o){if(o.lost)return void f("the WebGL context was lost");o.draw(l,performance.now()),c||(c=!0,e.postMessage({type:"drawn"}))}},m=t=>{h=0,n&&o?.ready&&(l+=Math.min(t-u,100)/1e3,u=t,T(),h=e.requestAnimationFrame(m))},E=()=>{!n&&o?.ready&&(o.settle(),T())},d=()=>{n&&!h&&o?.ready&&(u=performance.now(),h=e.requestAnimationFrame(m))};e.onmessage=t=>{let r=t.data;try{"init"===r.type?o=new a(r.canvas):o?"size"===r.type?(o.resize(r.w,r.h,r.dpr),E(),d()):"art"===r.type?(o.setArt(r.bitmap,performance.now()),r.bitmap.close(),E(),d()):"run"===r.type&&((n=r.on)?d():h&&(e.cancelAnimationFrame(h),h=0)):"art"===r.type&&r.bitmap.close()}catch(t){f(t)}},t.s([])}]);