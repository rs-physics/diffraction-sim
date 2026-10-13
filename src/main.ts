import './style.css';

/**
 * Double-slit diffraction simulator — TypeScript port of the original single-file version.
 *
 * Intentionally preserves the original experiment, zoom, detector traces,
 * approximate teaching-scale geometry and the placement of the δ/φ readouts.
 * The values in the animation are schematic, as in the original source.
 */

const root = document.querySelector<HTMLDivElement>('#app');
if (!root) throw new Error('Missing #app element in index.html');

root.innerHTML = `
  <main class="page">
    <header class="panel top-bar">
      <h1>Diffraction Simulator</h1>
      <div class="sliders" aria-label="Diffraction controls">
        <div class="slider-row">
          <label for="wavelengthSlider">Wavelength (nm)</label>
          <input id="wavelengthSlider" type="range" min="400" max="700" step="1" value="700" />
          <output id="wavelengthValue" for="wavelengthSlider">700 nm</output>
        </div>
        <div class="slider-row">
          <label for="slitSlider">Slit separation (mm)</label>
          <input id="slitSlider" type="range" min="0.1" max="0.3" step="0.01" value="0.1" />
          <output id="slitValue" for="slitSlider">0.10 mm</output>
        </div>
      </div>
    </header>

    <section class="panel diagram-panel" aria-label="Double slit experiment">
      <div id="diagramFrame" class="canvas-frame diagram-frame">
        <canvas id="diagram" role="img" aria-label="Laser, double slits, interference pattern and draggable detector"></canvas>
      </div>
    </section>

    <div class="lower-grid">
      <section class="panel zoom-panel" aria-labelledby="zoomHeading">
        <div class="panel-heading"><h2 id="zoomHeading">Double Slit – Zoomed in View</h2></div>
        <div id="zoomFrame" class="canvas-frame">
          <canvas id="zoom" role="img" aria-label="Slit geometry, path difference delta and angle theta"></canvas>
        </div>
        <p id="pathDiff" class="readout">Path difference (δ) ≈ 0.00λ</p>
      </section>

      <section class="panel detector-panel" aria-labelledby="detectorHeading">
        <div class="panel-heading detector-heading">
          <h2 id="detectorHeading">Detector Signal</h2>
          <label class="freeze-label" for="freezeToggle">
            <input type="checkbox" id="freezeToggle" /> Freeze animation
          </label>
        </div>
        <div class="wave-block">
          <h3>Signal showing wave from upper slit (green) and lower slit (red)</h3>
          <div id="waveFrame" class="canvas-frame">
            <canvas id="wave" role="img" aria-label="Two waves arriving at the detector"></canvas>
          </div>
          <p id="phaseDiff" class="readout">Phase difference (φ) ≈ 0.00π</p>
        </div>
        <div class="wave-block">
          <h3>Superposition of the signals – what the detector (and we) see</h3>
          <div id="superpositionFrame" class="canvas-frame">
            <canvas id="superposition" role="img" aria-label="Resultant superposition wave"></canvas>
          </div>
        </div>
      </section>
    </div>
  </main>
`;

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing element: #${id}`);
  return found as T;
}

function context(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D not available');
  return ctx;
}

const diagram = element<HTMLCanvasElement>('diagram');
const wave = element<HTMLCanvasElement>('wave');
const superposition = element<HTMLCanvasElement>('superposition');
const zoom = element<HTMLCanvasElement>('zoom');
const diagramFrame = element<HTMLDivElement>('diagramFrame');
const zoomFrame = element<HTMLDivElement>('zoomFrame');
const waveFrame = element<HTMLDivElement>('waveFrame');
const superpositionFrame = element<HTMLDivElement>('superpositionFrame');
const dctx = context(diagram);
const wctx = context(wave);
const sctx = context(superposition);
const zctx = context(zoom);

const wavelengthSlider = element<HTMLInputElement>('wavelengthSlider');
const slitSlider = element<HTMLInputElement>('slitSlider');
const wavelengthValue = element<HTMLOutputElement>('wavelengthValue');
const slitValue = element<HTMLOutputElement>('slitValue');
const freezeToggle = element<HTMLInputElement>('freezeToggle');
const pathDiff = element<HTMLParagraphElement>('pathDiff');
const phaseDiff = element<HTMLParagraphElement>('phaseDiff');

// Extracted directly from the two base64 images embedded in the original HTML.
// Vite bundles these assets and resolves the correct GitHub Pages base path.
const laserImg = new Image();
laserImg.src = new URL('./assets/laser.png', import.meta.url).href;
const detectorImg = new Image();
detectorImg.src = new URL('./assets/detector.png', import.meta.url).href;

interface RGB { r: number; g: number; b: number }
interface CanvasSize { width: number; height: number }

const sizes: Record<'diagram' | 'zoom' | 'wave' | 'superposition', CanvasSize> = {
  diagram: { width: 900, height: 400 },
  zoom: { width: 400, height: 200 },
  wave: { width: 400, height: 130 },
  superposition: { width: 400, height: 130 },
};

// Original simulation scaling. These are display-space quantities rather than
// physical metre/nanometre conversions; the pattern and traces share this scale.
let lambdaNm = 700;
let separationMm = 0.1;
let displayedWavelength = lambdaNm / 500;
let displayedSeparation = separationMm * 100;
let displayedScreenDistance = 1;

const handleW = 40;
const handleH = 20;
let handleX = 0;
let handleY = 200;
let handleMinY = 20;
let handleMaxY = 380;
let detectorPosition = 0; // fraction of travel range, -1 to 1
let draggingPointer: number | null = null;
let time = 0;
let lastTimestamp: number | null = null;
const amplitudeFraction = .25;

/** Resize the backing store for crisp Retina rendering, keeping drawing in CSS pixels. */
function sizeCanvas(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D,
                    width: number, height: number): void {
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 3);
  canvas.style.width = '100%';
  canvas.style.height = `${height}px`;
  canvas.width = Math.round(width * pixelRatio);
  canvas.height = Math.round(height * pixelRatio);
  ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
}

function frameWidth(frame: HTMLElement): number {
  // A 1px border on each edge is reserved for the frame.
  return Math.max(1, frame.clientWidth - 2);
}

function resize(): void {
  const mainW = frameWidth(diagramFrame);
  const mainH = 400;
  sizes.diagram = { width: mainW, height: mainH };
  sizeCanvas(diagram, dctx, mainW, mainH);

  const zoomW = frameWidth(zoomFrame);
  sizes.zoom = { width: zoomW, height: 200 };
  sizeCanvas(zoom, zctx, zoomW, 200);

  const waveW = frameWidth(waveFrame);
  const scanW = frameWidth(superpositionFrame);
  sizes.wave = { width: waveW, height: 130 };
  sizes.superposition = { width: scanW, height: 130 };
  sizeCanvas(wave, wctx, waveW, 130);
  sizeCanvas(superposition, sctx, scanW, 130);

  const screenX = mainW - 80;
  handleX = screenX + 45;
  handleMinY = 20;
  handleMaxY = mainH - 20;
  handleY = mainH / 2 + detectorPosition * (mainH / 2 - 20);
  displayedScreenDistance = screenX - mainW * .25;
}

wavelengthSlider.addEventListener('input', () => {
  lambdaNm = Number(wavelengthSlider.value);
  displayedWavelength = lambdaNm / 500;
  wavelengthValue.value = `${lambdaNm} nm`;
  wavelengthValue.textContent = wavelengthValue.value;
});

slitSlider.addEventListener('input', () => {
  separationMm = Number(slitSlider.value);
  displayedSeparation = separationMm * 100;
  slitValue.value = `${separationMm.toFixed(2)} mm`;
  slitValue.textContent = slitValue.value;
});

function eventXY(event: PointerEvent): { x: number; y: number } {
  const bounds = diagram.getBoundingClientRect();
  // Canvas may be visually scaled: convert pointer coords to drawing coords.
  const { width, height } = sizes.diagram;
  return {
    x: (event.clientX - bounds.left) * width / bounds.width,
    y: (event.clientY - bounds.top) * height / bounds.height,
  };
}

function overHandle(x: number, y: number): boolean {
  return Math.abs(x - handleX) <= handleW / 2 + 5 &&
         Math.abs(y - handleY) <= handleH / 2 + 5;
}

diagram.addEventListener('pointerdown', (event: PointerEvent) => {
  const { x, y } = eventXY(event);
  if (!overHandle(x, y)) return;
  draggingPointer = event.pointerId;
  diagram.setPointerCapture(event.pointerId);
  diagram.classList.add('dragging');
  event.preventDefault();
});

diagram.addEventListener('pointermove', (event: PointerEvent) => {
  const { x, y } = eventXY(event);
  if (draggingPointer !== event.pointerId) {
    diagram.classList.toggle('drag-ready', overHandle(x, y));
    return;
  }
  handleY = Math.max(handleMinY, Math.min(handleMaxY, y));
  detectorPosition = (handleY - sizes.diagram.height / 2) /
    (sizes.diagram.height / 2 - 20);
  event.preventDefault();
});

function stopDrag(event: PointerEvent): void {
  if (draggingPointer !== event.pointerId) return;
  draggingPointer = null;
  diagram.classList.remove('dragging');
  if (diagram.hasPointerCapture(event.pointerId)) {
    diagram.releasePointerCapture(event.pointerId);
  }
}

diagram.addEventListener('pointerup', stopDrag);
diagram.addEventListener('pointercancel', stopDrag);
diagram.addEventListener('pointerleave', () => diagram.classList.remove('drag-ready'));

const colourStops = [
  { w: 400, r: 0, g: 0, b: 200 },
  { w: 475, r: 0, g: 255, b: 255 },
  { w: 550, r: 0, g: 200, b: 0 },
  { w: 625, r: 255, g: 255, b: 0 },
  { w: 700, r: 200, g: 0, b: 0 },
];

function wavelengthToRGB(value: number): RGB {
  const wl = Math.max(400, Math.min(700, value));
  let index = 0;
  while (index < colourStops.length - 2 && wl > colourStops[index + 1].w) index++;
  const a = colourStops[index];
  const b = colourStops[index + 1];
  const blend = (wl - a.w) / (b.w - a.w);
  return {
    r: Math.round(a.r + blend * (b.r - a.r)),
    g: Math.round(a.g + blend * (b.g - a.g)),
    b: Math.round(a.b + blend * (b.b - a.b)),
  };
}

function colour(rgb: RGB): string {
  return `rgb(${rgb.r},${rgb.g},${rgb.b})`;
}

function paintInterference(screenX: number, screenW: number,
                           top: number, bottom: number, mid: number, rgb: RGB): void {
  const fringeSpacing = displayedWavelength * displayedScreenDistance / displayedSeparation;
  const step = 2;
  for (let y = top; y < bottom; y += step) {
    const n = (y - mid) / fringeSpacing;
    const brightness = Math.cos(Math.PI * n) ** 2;
    dctx.fillStyle = colour({
      r: Math.round(rgb.r * brightness),
      g: Math.round(rgb.g * brightness),
      b: Math.round(rgb.b * brightness),
    });
    dctx.fillRect(screenX, y, screenW, step);
  }
}

function drawDiagram(): void {
  const { width: w, height: h } = sizes.diagram;
  const midY = h / 2;
  const laserColour = wavelengthToRGB(lambdaNm);
  const gratX = w * .25;
  const screenX = w - 80;
  const screenW = 20;

  dctx.clearRect(0, 0, w, h);
  if (laserImg.complete && laserImg.naturalWidth > 0) {
    const imageWidth = Math.min(65, Math.max(20, gratX - 20));
    dctx.drawImage(laserImg, 5, midY - 15, imageWidth, 30);
  }

  // Incident beam and three solid segments defining the two apertures.
  dctx.strokeStyle = colour(laserColour);
  dctx.lineWidth = 20;
  dctx.beginPath();
  dctx.moveTo(Math.min(70, gratX - 10), midY);
  dctx.lineTo(gratX, midY);
  dctx.stroke();


  const barrierW = 6;
  const barrierH = 8;
  const gap = 4;
  const margin = 10;

  dctx.fillStyle = '#263548';

// Upper barrier: extends towards the top of the canvas
  const upperEnd = midY - barrierH / 2 - gap;
  dctx.fillRect(
      gratX - barrierW / 2,
      margin,
      barrierW,
      upperEnd - margin
  );

// Central barrier: separates the two slits
  dctx.fillRect(
      gratX - barrierW / 2,
      midY - barrierH / 2,
      barrierW,
      barrierH
  );

// Lower barrier: extends towards the bottom of the canvas
  const lowerStart = midY + barrierH / 2 + gap;
  dctx.fillRect(
      gratX - barrierW / 2,
      lowerStart,
      barrierW,
      h - margin - lowerStart
  );


  paintInterference(screenX, screenW, 10, h - 10, midY, laserColour);
  dctx.strokeStyle = '#334155';
  dctx.lineWidth = 1;
  dctx.strokeRect(screenX, 10, screenW, h - 20);

  // The two paths to the draggable detector.
  const slitOffset = barrierH - gap / 2;
  dctx.strokeStyle = '#129d39';
  dctx.lineWidth = 1.7;
  dctx.beginPath();
  dctx.moveTo(gratX, midY - slitOffset);
  dctx.lineTo(screenX, handleY);
  dctx.stroke();

  dctx.strokeStyle = '#e04747';
  dctx.beginPath();
  dctx.moveTo(gratX, midY + slitOffset);
  dctx.lineTo(screenX, handleY);
  dctx.stroke();

  dctx.fillStyle = 'white';
  dctx.beginPath();
  dctx.arc(screenX + screenW / 2, handleY, 2.5, 0, 2 * Math.PI);
  dctx.fill();

  if (detectorImg.complete && detectorImg.naturalWidth > 0) {
    dctx.drawImage(detectorImg, handleX - handleW / 2, handleY - handleH / 2,
      handleW, handleH);
  } else {
    // Visible detector fallback if the image has not finished loading.
    dctx.fillStyle = '#64748b';
    dctx.fillRect(handleX - handleW / 2, handleY - handleH / 2, handleW, handleH);
  }
}

function drawWaves(n: number): void {
  const { width: w, height: h } = sizes.wave;
  const mid = h / 2;
  const k = 2 * Math.PI / (displayedWavelength * 150);
  const omega = .2 * (2 * Math.PI / displayedWavelength);
  const amplitude = h * amplitudeFraction;
  const phase = 2 * Math.PI * n;

  wctx.clearRect(0, 0, w, h);
  wctx.lineWidth = 2;
  // Original phase convention: red reference, green offset by delta.
  wctx.strokeStyle = '#dc4040';
  wctx.beginPath();
  for (let x = 0; x <= w; x++) {
    const y = mid + amplitude * Math.sin(k * x + omega * time);
    if (x === 0) wctx.moveTo(x, y); else wctx.lineTo(x, y);
  }
  wctx.stroke();

  wctx.strokeStyle = '#14a33c';
  wctx.beginPath();
  for (let x = 0; x <= w; x++) {
    const y = mid + amplitude * Math.sin(k * x + omega * time + phase);
    if (x === 0) wctx.moveTo(x, y); else wctx.lineTo(x, y);
  }
  wctx.stroke();

  wctx.strokeStyle = '#b4c1ce';
  wctx.lineWidth = 1;
  wctx.beginPath();
  wctx.moveTo(w - 1, 0);
  wctx.lineTo(w - 1, h);
  wctx.stroke();

  // Kept exactly in the original locations: under the zoom and wave panels.
  pathDiff.textContent = `Path difference (δ) ≈ ${(-n).toFixed(2)}λ`;
  phaseDiff.textContent = `Phase difference (φ) ≈ ${(-phase / Math.PI).toFixed(2)}π`;
}

function drawSuperposition(n: number): void {
  const { width: w, height: h } = sizes.superposition;
  const mid = h / 2;
  const amplitude = h * amplitudeFraction;
  const phase = 2 * Math.PI * n;
  const k = 2 * Math.PI / (displayedWavelength * 150);
  const omega = .2 * (2 * Math.PI / displayedWavelength);
  const coeff = .8;

  sctx.clearRect(0, 0, w, h);
  sctx.strokeStyle = '#263548';
  sctx.lineWidth = 2;
  sctx.beginPath();
  for (let x = 0; x <= w; x++) {
    const a = Math.sin(k * x + omega * time);
    const b = Math.sin(k * x + omega * time + phase);
    const y = mid + amplitude * coeff * (a + b);
    if (x === 0) sctx.moveTo(x, y); else sctx.lineTo(x, y);
  }
  sctx.stroke();

  sctx.strokeStyle = '#b4c1ce';
  sctx.lineWidth = 1;
  sctx.beginPath();
  sctx.moveTo(w - 1, 0);
  sctx.lineTo(w - 1, h);
  sctx.stroke();
}

function drawZoom(): void {
  const { width: w, height: h } = sizes.zoom;
  zctx.clearRect(0, 0, w, h);

  // Preserve the geometry and visual scale of the original zoom illustration.
  const slitX = 50;
  const marginFactor = .22 - separationMm / 4;
  const margin = marginFactor * h;
  const upperY = margin;
  const lowerY = h - margin;
  const slitH = 8;
  const barrierWidth = 8;

  const displacement = handleY - sizes.diagram.height / 2;
  const theta = -displacement / displayedScreenDistance;
  const dx = Math.max(80, w - slitX - 20);
  const dy = -theta * dx;
  const length = Math.hypot(dx, dy);
  const ux = dx / length;
  const uy = dy / length;
  const px = -uy;
  const py = ux;

  // Lightened barrier: blue construction line remains legible through it.
  zctx.fillStyle = '#cbd5e1';
  zctx.fillRect(slitX - barrierWidth / 2, 0, barrierWidth, h);
  zctx.clearRect(slitX - barrierWidth / 2, upperY - slitH / 2, barrierWidth, slitH);
  zctx.clearRect(slitX - barrierWidth / 2, lowerY - slitH / 2, barrierWidth, slitH);

  zctx.strokeStyle = '#129d39';
  zctx.lineWidth = 1.8;
  zctx.beginPath();
  zctx.moveTo(slitX, upperY);
  zctx.lineTo(slitX + dx, upperY + dy);
  zctx.stroke();

  zctx.strokeStyle = '#e04747';
  zctx.beginPath();
  zctx.moveTo(slitX, lowerY);
  zctx.lineTo(slitX + dx, lowerY + dy);
  zctx.stroke();

  // Perpendicular construction from the upper slit to the lower ray.
  const projection = (upperY - lowerY) * uy;
  const footX = slitX + projection * ux;
  const footY = lowerY + projection * uy;
  zctx.save();
  zctx.strokeStyle = '#245fd1';
  zctx.lineWidth = 1.6;
  zctx.setLineDash([6, 4]);
  zctx.beginPath();
  zctx.moveTo(slitX, upperY);
  zctx.lineTo(footX, footY);
  zctx.stroke();
  zctx.restore();

  // Original offset path-difference dimension line with endpoint ticks.
  const offset = 8;
  const tickLen = 10;
  const startX = slitX + px * offset;
  const startY = lowerY + py * offset;
  const endX = footX + px * offset;
  const endY = footY + py * offset;
  zctx.strokeStyle = '#9c5f27';
  zctx.lineWidth = 2;
  zctx.beginPath();
  zctx.moveTo(startX, startY);
  zctx.lineTo(endX, endY);
  zctx.stroke();

  const tickDX = tickLen / 2 * px;
  const tickDY = tickLen / 2 * py;
  zctx.beginPath();
  zctx.moveTo(startX + tickDX, startY + tickDY);
  zctx.lineTo(startX - tickDX, startY - tickDY);
  zctx.moveTo(endX + tickDX, endY + tickDY);
  zctx.lineTo(endX - tickDX, endY - tickDY);
  zctx.stroke();

  zctx.font = '14px DM Sans, sans-serif';
  zctx.fillStyle = '#8b4c18';
  zctx.fillText('δ', (startX + endX) / 2 - 2, (startY + endY) / 2 + 13);

  // Small angle between the slit separation line and the projection normal.
  const radius = Math.min(95, h * .48);
  const start = Math.PI / 2;
  const rawEnd = Math.atan2(py, px);
  const difference = Math.atan2(Math.sin(rawEnd - start), Math.cos(rawEnd - start));
  const end = start + difference;
  zctx.strokeStyle = '#245fd1';
  zctx.lineWidth = 1.5;
  zctx.beginPath();
  zctx.arc(slitX, upperY, radius, start, end, difference < 0);
  zctx.stroke();
  const midAngle = start + difference / 2;
  zctx.font = '14px DM Sans, sans-serif';
  zctx.fillStyle = '#245fd1';
  zctx.fillText('θ', slitX + (radius + 10) * Math.cos(midAngle) - 4,
    upperY + (radius + 10) * Math.sin(midAngle) + 5);
}

function render(): void {
  const half = sizes.diagram.height / 2;
  const displacement = handleY - half;
  const n = displacement * displayedSeparation /
    (displayedWavelength * displayedScreenDistance);
  drawDiagram();
  drawWaves(n);
  drawSuperposition(n);
  drawZoom();
}

function animate(timestamp: number): void {
  // Time scales by real frame duration; maintains the original ~60fps speed.
  if (lastTimestamp === null) lastTimestamp = timestamp;
  const dt = Math.min(50, timestamp - lastTimestamp);
  lastTimestamp = timestamp;
  if (!freezeToggle.checked) time += .05 * dt / (1000 / 60);
  render();
  requestAnimationFrame(animate);
}

let resizeQueued = false;
function queueResize(): void {
  if (resizeQueued) return;
  resizeQueued = true;
  requestAnimationFrame(() => {
    resizeQueued = false;
    resize();
  });
}

// Both media-query layout changes and normal window resizing are handled.
window.addEventListener('resize', queueResize);
new ResizeObserver(queueResize).observe(root);
resize();
requestAnimationFrame(animate);
