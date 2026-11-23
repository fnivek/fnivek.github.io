// =====================================================================
//  AURA JUMP: a jumping game starring Aura the bearded dragon.
//  The whole game is in this one script. Read it top to bottom:
//    1. Setup        2. Sounds and music    3. The game world
//    4. Controls     5. Update (the rules)  6. Draw (the pictures)
//    7. The game loop
// =====================================================================

// ---------- 1. SETUP ----------
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");      // ctx is our paint brush
const W = 400, H = 600;                    // the game world is 400 x 600 pixels

// Sharp pictures on iPads and phones: they pack 2 or 3 real pixels into each "pixel",
// so we make the canvas that much bigger and scale the brush to match.
const sharp = Math.min(window.devicePixelRatio || 1, 3);
canvas.width = W * sharp;
canvas.height = H * sharp;
ctx.scale(sharp, sharp);

// Is this a touch screen (iPad, phone)? Then we show touch hints instead of keyboard ones.
const isTouch = matchMedia("(pointer: coarse)").matches;

const GRAVITY = 0.4;     // how hard Aura is pulled down each frame
const JUMP = -11;        // speed of a normal bounce (negative = up)
const SUPER_JUMP = -19;  // speed of a leaf bounce
const RUN = 5.5;         // how fast Aura moves left and right

const photo = new Image();     // Aura's real photo for the title screen
photo.src = "aura.jpg";

let best = 0;                  // best score, remembered by the browser
try { best = Number(localStorage.getItem("aura-best")) || 0; } catch (e) {}

// ---------- 2. SOUNDS AND MUSIC ----------
// No sound files! We make every sound with the Web Audio "synthesizer".
let audio = null, muted = false;

function startAudio() {
  // iPhone: play sound even when the silent switch is on.
  if (navigator.audioSession) navigator.audioSession.type = "playback";
  if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)();
  if (audio.state !== "running") audio.resume();
}

// BUG FIX: browsers only allow sound after certain events ("user activation").
// On a phone, touching the screen DOWN does not count, only lifting the finger UP does.
// So we try to switch the sound on after every tap, click or key press.
for (const name of ["pointerup", "touchend", "click", "keydown"]) {
  addEventListener(name, startAudio);
}

// Play one note: a wave that slides from one pitch to another.
function beep(type, fromHz, toHz, seconds, volume = 0.2) {
  if (!audio || muted) return;
  const t = audio.currentTime;
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = type;                                     // "sine", "square", "triangle", "sawtooth"
  osc.frequency.setValueAtTime(fromHz, t);
  osc.frequency.exponentialRampToValueAtTime(toHz, t + seconds);
  gain.gain.setValueAtTime(volume, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + seconds); // fade out
  osc.connect(gain).connect(audio.destination);
  osc.start(t);
  osc.stop(t + seconds);
}

// A short crackle of random noise (for crunches and breaking rocks).
function noise(seconds, volume = 0.2) {
  if (!audio || muted) return;
  const buffer = audio.createBuffer(1, audio.sampleRate * seconds, audio.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  const src = audio.createBufferSource();
  const gain = audio.createGain();
  gain.gain.value = volume;
  src.buffer = buffer;
  src.connect(gain).connect(audio.destination);
  src.start();
}

const sound = {
  jump:    () => beep("sine", 300, 700, 0.15),
  spring:  () => beep("square", 200, 1200, 0.4, 0.12),
  cricket: () => { noise(0.08, 0.3); beep("square", 900, 1400, 0.1, 0.08); },
  crumble: () => noise(0.3, 0.25),
  gameOver:() => beep("sawtooth", 500, 60, 1.0, 0.15),
  spit:    () => beep("square", 800, 200, 0.12, 0.1),
  splat:   () => { noise(0.25, 0.35); beep("sine", 180, 50, 0.3, 0.25); },
  empty:   () => beep("square", 120, 100, 0.05, 0.08),   // click: no ammo left
};

// Background music: a little tune that loops. Each number is a note (Hz), 0 means rest.
const melody = [523, 0, 659, 0, 784, 659, 523, 0, 587, 0, 698, 0, 880, 698, 587, 0,
                659, 0, 784, 0, 988, 784, 659, 0, 784, 698, 659, 587, 523, 0, 0, 0];
const bass   = [131, 131, 131, 131, 147, 147, 147, 147, 165, 165, 165, 165, 196, 196, 131, 131];
let step = 0;
setInterval(() => {
  if (state === "playing" && !document.hidden) {   // no music while the app is in the background
    if (melody[step % melody.length]) beep("triangle", melody[step % melody.length],
                                           melody[step % melody.length], 0.18, 0.08);
    if (step % 2 === 0) beep("square", bass[(step / 2) % bass.length],
                             bass[(step / 2) % bass.length], 0.2, 0.03);
  }
  step++;
}, 160);

// ---------- 3. THE GAME WORLD ----------
// state is "title", "playing" or "over".
let state = "title";
let aura, platforms, crickets, score, cameraTop;
let veggies, spits, ammo, deathMessage;      // enemies, flying crickets, crickets in Aura's mouth
const VEGGIE_KINDS = ["broccoli", "lettuce", "carrot"];

function newGame() {
  aura = { x: W / 2 - 20, y: H - 120, w: 40, h: 30, vx: 0, vy: JUMP, facing: 1 };
  platforms = [];
  crickets = [];
  veggies = [];
  spits = [];
  ammo = 3;           // start with 3 crickets to spit
  deathMessage = "Oh no, Aura fell!";
  score = 0;
  cameraTop = 0;  // how far up we have climbed
  // A wide starting rock right under Aura, then rocks going up the screen.
  platforms.push({ x: W / 2 - 40, y: H - 60, w: 80, kind: "rock", dx: 0 });
  let y = H - 60;
  while (y > -H) { y -= gap(); addPlatform(y); }
  state = "playing";
}

// Rocks get further apart as you climb, so it gets harder.
function gap() { return 60 + Math.random() * Math.min(50, score / 100); }

// Make one platform at height y. Some are special.
function addPlatform(y) {
  const roll = Math.random();
  let kind = "rock";
  if (score > 500 && roll < 0.15) kind = "crumbly";    // breaks when Aura lands
  else if (score > 300 && roll < 0.3) kind = "moving"; // slides side to side
  const p = { x: Math.random() * (W - 70), y, w: 70, kind, dx: kind === "moving" ? 1.5 : 0, leaf: false };
  if (kind === "rock" && Math.random() < 0.08) p.leaf = true;          // super jump leaf
  if (kind !== "crumbly" && Math.random() < 0.2) {                       // a cricket to eat
    crickets.push({ x: p.x + p.w / 2, y: y - 30, wiggle: Math.random() * 6 });
  }
  platforms.push(p);
  // Once you are a bit higher, angry veggies start floating between the rocks.
  if (score > 300 && Math.random() < 0.12) {
    const kind = VEGGIE_KINDS[Math.floor(Math.random() * VEGGIE_KINDS.length)];
    veggies.push({ x: 30 + Math.random() * (W - 60), y: y - 40, kind, dx: Math.random() < 0.5 ? 1 : -1 });
  }
}

// Spit one cricket straight up, if Aura has any.
function spit() {
  if (state !== "playing") return;
  if (ammo <= 0) { sound.empty(); return; }
  ammo -= 1;
  spits.push({ x: aura.x + aura.w / 2, y: aura.y });
  sound.spit();
}

// ---------- 4. CONTROLS ----------
const keys = { left: false, right: false };

addEventListener("keydown", (e) => {
  if (["ArrowLeft", "a", "A"].includes(e.key)) keys.left = true;
  if (["ArrowRight", "d", "D"].includes(e.key)) keys.right = true;
  if (e.key === "m" || e.key === "M") toggleMute();
  if ((e.key === " " || e.key === "Enter") && state !== "playing") {
    if (canStart()) { startAudio(); newGame(); }
    return;
  }
  if ([" ", "ArrowUp", "w", "W"].includes(e.key) && !e.repeat) spit();
  if (e.key.startsWith("Arrow") || e.key === " ") e.preventDefault();
});
addEventListener("keyup", (e) => {
  if (["ArrowLeft", "a", "A"].includes(e.key)) keys.left = false;
  if (["ArrowRight", "d", "D"].includes(e.key)) keys.right = false;
});

// Touch or mouse: hold the left half to go left, the right half to go right.
// The "touch area" is the whole screen in the full-screen version, or just the game box.
// Every finger is tracked on its own, so you can steer with one and spit with another.
const touchArea = document.querySelector("[data-touch-area]") || canvas;
const fingers = new Map();   // finger id -> "left" or "right"

function sideOf(e) {
  const box = touchArea.getBoundingClientRect();
  return e.clientX - box.left < box.width / 2 ? "left" : "right";
}
function steerFromFingers() {
  const sides = [...fingers.values()];
  keys.left = sides.includes("left");
  keys.right = sides.includes("right");
}
touchArea.addEventListener("pointerdown", (e) => {
  if (e.target.closest("button, a")) return;   // buttons do their own thing
  e.preventDefault();
  startAudio();
  if (state !== "playing") { if (canStart()) newGame(); return; }
  fingers.set(e.pointerId, sideOf(e));
  steerFromFingers();
});
addEventListener("pointermove", (e) => {      // slide a finger across to change side
  if (fingers.has(e.pointerId)) { fingers.set(e.pointerId, sideOf(e)); steerFromFingers(); }
});
for (const name of ["pointerup", "pointercancel"]) {
  addEventListener(name, (e) => { fingers.delete(e.pointerId); steerFromFingers(); });
}

// After Aura falls, wait a moment so a finger that is still holding does not start a new game by accident.
let endedAt = -Infinity;   // no game has ended yet
function canStart() { return performance.now() - endedAt > 800; }

// Stop the iPad from zooming or showing menus when little fingers tap fast.
addEventListener("gesturestart", (e) => e.preventDefault());
addEventListener("dblclick", (e) => e.preventDefault());
addEventListener("contextmenu", (e) => { if (e.target === canvas) e.preventDefault(); });

const muteButton = document.getElementById("mute");
function toggleMute() {
  muted = !muted;
  muteButton.textContent = muted ? "Sound: off" : "Sound: on";
}
muteButton.addEventListener("click", toggleMute);
document.getElementById("spit").addEventListener("pointerdown", (e) => { e.preventDefault(); spit(); });

// ---------- 5. UPDATE: the rules of the game, run 60 times a second ----------
function update() {
  if (state !== "playing") return;

  // Steering
  if (keys.left)  { aura.vx = -RUN; aura.facing = -1; }
  else if (keys.right) { aura.vx = RUN; aura.facing = 1; }
  else aura.vx *= 0.8;   // slow down when no key is held

  // Gravity pulls Aura down, speed moves her
  aura.vy += GRAVITY;
  aura.x += aura.vx;
  aura.y += aura.vy;

  // Walk off one side, come back on the other
  if (aura.x > W) aura.x = -aura.w;
  if (aura.x < -aura.w) aura.x = W;

  // Moving platforms slide and bounce off the walls
  for (const p of platforms) {
    p.x += p.dx;
    if (p.x < 0 || p.x + p.w > W) p.dx = -p.dx;
  }

  // Landing: only while falling, and only if her feet cross the top of a rock
  if (aura.vy > 0) {
    for (const p of platforms) {
      const feet = aura.y + aura.h;
      const overRock = aura.x + aura.w > p.x + 5 && aura.x < p.x + p.w - 5;
      if (overRock && feet >= p.y && feet - aura.vy <= p.y) {
        if (p.kind === "crumbly") { p.broken = true; sound.crumble(); continue; }
        aura.y = p.y - aura.h;
        if (p.leaf) { aura.vy = SUPER_JUMP; sound.spring(); }
        else { aura.vy = JUMP; sound.jump(); }
      }
    }
    platforms = platforms.filter((p) => !p.broken);
  }

  // Eat crickets she touches
  for (const c of crickets) {
    if (Math.abs(aura.x + aura.w / 2 - c.x) < 28 && Math.abs(aura.y + aura.h / 2 - c.y) < 28) {
      c.eaten = true;
      ammo += 1;          // crickets are ammo now!
      sound.cricket();
    }
  }
  crickets = crickets.filter((c) => !c.eaten);

  // Veggies drift side to side
  for (const v of veggies) {
    v.x += v.dx;
    if (v.x < 20 || v.x > W - 20) v.dx = -v.dx;
  }

  // Spit crickets fly up. If one hits a veggie, both disappear: SPLAT!
  for (const s of spits) {
    s.y -= 10;
    for (const v of veggies) {
      if (!v.hit && Math.abs(s.x - v.x) < 22 && Math.abs(s.y - v.y) < 22) {
        v.hit = true; s.gone = true;
        score += 100;
        sound.splat();
      }
    }
  }
  spits = spits.filter((s) => !s.gone && s.y > -20);

  // Bumping into a veggie: land on top to squash it, any other way is game over.
  const ax = aura.x + aura.w / 2, ay = aura.y + aura.h / 2;
  for (const v of veggies) {
    if (v.hit || Math.abs(ax - v.x) > 32 || Math.abs(ay - v.y) > 30) continue;
    if (aura.vy > 0 && ay < v.y - 8) {   // falling and above it: squash!
      v.hit = true;
      aura.vy = JUMP;
      score += 100;
      sound.splat();
    } else {
      deathMessage = "A " + v.kind + " got Aura!";
      endGame();
      return;
    }
  }
  veggies = veggies.filter((v) => !v.hit);

  // Camera: when Aura goes above the middle, move the whole world down instead
  const line = H * 0.4;
  if (aura.y < line) {
    const shift = line - aura.y;
    aura.y = line;
    for (const p of platforms) p.y += shift;
    for (const c of crickets) c.y += shift;
    for (const v of veggies) v.y += shift;
    for (const s of spits) s.y += shift;
    cameraTop += shift;
    score += Math.round(shift / 2);
  }

  // Remove rocks that fell off the bottom and add new ones at the top
  platforms = platforms.filter((p) => p.y < H + 20);
  crickets = crickets.filter((c) => c.y < H + 20);
  veggies = veggies.filter((v) => v.y < H + 40);
  let highest = Math.min(H, ...platforms.map((p) => p.y));
  while (highest > -40) { highest -= gap(); addPlatform(highest); }

  // Fell off the bottom? Game over.
  if (aura.y > H) endGame();
}

function endGame() {
  state = "over";
  endedAt = performance.now();
  sound.gameOver();
  if (score > best) {
    best = score;
    try { localStorage.setItem("aura-best", best); } catch (e) {}
  }
}

// ---------- 6. DRAW: paint everything, 60 times a second ----------
const COLORS = {
  sky: "#1e1e2e", grid: "#313244", text: "#cdd6f4", muted: "#a6adc8",
  rock: "#a6957f", rockTop: "#c9b79c", moving: "#89b4fa", crumbly: "#7f6f64",
  leaf: "#a6e3a1", aura: "#f0802f", auraDark: "#c25a1c", belly: "#f9c58d", cricket: "#6c5a3e",
};

function draw() {
  // Background: graph paper that scrolls as we climb
  ctx.fillStyle = COLORS.sky;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = 1;
  const offset = cameraTop % 25;
  for (let y = offset; y < H; y += 25) line(0, y, W, y);
  for (let x = 0; x < W; x += 25) line(x, 0, x, H);

  if (state === "title") return drawTitle();

  for (const p of platforms) drawPlatform(p);
  for (const c of crickets) drawCricket(c);
  for (const v of veggies) drawVeggie(v);
  for (const s of spits) drawCricket({ x: s.x, y: s.y, wiggle: 0 });
  drawAura(aura.x, aura.y, aura.facing, aura.vy < 0);

  // Ammo counter: a little cricket and how many Aura has
  drawCricket({ x: W / 2 - 22, y: 22, wiggle: 0 });
  ctx.fillStyle = COLORS.text;
  ctx.font = "bold 22px system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText("x " + ammo, W / 2 - 4, 30);

  // Score in the corner
  ctx.fillStyle = COLORS.text;
  ctx.font = "bold 22px system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText("Score: " + score, 12, 30);
  ctx.textAlign = "right";
  ctx.fillStyle = COLORS.muted;
  ctx.fillText("Best: " + best, W - 12, 30);

  if (state === "over") drawGameOver();
}

function line(x1, y1, x2, y2) { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); }

function drawPlatform(p) {
  ctx.fillStyle = p.kind === "moving" ? COLORS.moving : p.kind === "crumbly" ? COLORS.crumbly : COLORS.rock;
  roundRect(p.x, p.y, p.w, 14, 7);
  ctx.fillStyle = COLORS.rockTop;
  if (p.kind === "rock") roundRect(p.x + 4, p.y + 1, p.w - 8, 4, 2);
  if (p.kind === "crumbly") {           // cracks
    ctx.strokeStyle = COLORS.sky;
    line(p.x + 20, p.y, p.x + 28, p.y + 14);
    line(p.x + 48, p.y, p.x + 42, p.y + 14);
  }
  if (p.leaf) {                         // a green leaf on top = super jump
    ctx.fillStyle = COLORS.leaf;
    ctx.beginPath();
    ctx.ellipse(p.x + p.w / 2, p.y - 5, 14, 6, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawCricket(c) {
  const wobble = Math.sin(Date.now() / 120 + c.wiggle) * 2;
  ctx.fillStyle = COLORS.cricket;
  ctx.beginPath();
  ctx.ellipse(c.x, c.y + wobble, 10, 5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = COLORS.cricket;
  ctx.lineWidth = 2;
  line(c.x - 4, c.y + wobble, c.x - 10, c.y + 8);   // legs
  line(c.x + 4, c.y + wobble, c.x + 12, c.y + 8);
  line(c.x + 9, c.y + wobble - 2, c.x + 16, c.y - 10); // antenna
  ctx.lineWidth = 1;
}

// Angry veggies! Each kind is a few shapes, and they all share the same angry eyes.
function drawVeggie(v) {
  const bob = Math.sin(Date.now() / 300 + v.x) * 3;   // gentle floating
  const x = v.x, y = v.y + bob;
  if (v.kind === "broccoli") {
    ctx.fillStyle = "#94e2d5";                          // stem
    roundRect(x - 5, y, 10, 16, 3);
    ctx.fillStyle = "#40a02b";                          // bumpy top: 4 circles
    for (const [cx, cy] of [[-10, -4], [10, -4], [0, -12], [0, 0]]) {
      ctx.beginPath(); ctx.arc(x + cx, y + cy, 10, 0, Math.PI * 2); ctx.fill();
    }
  } else if (v.kind === "lettuce") {
    ctx.fillStyle = "#a6e3a1";                          // wavy leaves: 3 ellipses
    for (const a of [-0.5, 0, 0.5]) {
      ctx.beginPath(); ctx.ellipse(x, y, 20, 13, a, 0, Math.PI * 2); ctx.fill();
    }
  } else {                                              // carrot
    ctx.fillStyle = "#fe640b";
    ctx.beginPath(); ctx.moveTo(x - 12, y - 10); ctx.lineTo(x + 12, y - 10); ctx.lineTo(x, y + 20); ctx.fill();
    ctx.fillStyle = "#40a02b";                          // leafy hair
    ctx.beginPath(); ctx.moveTo(x - 8, y - 10); ctx.lineTo(x, y - 24); ctx.lineTo(x + 8, y - 10); ctx.fill();
  }
  // Angry eyes and eyebrows
  ctx.fillStyle = "#ffffff";
  ctx.beginPath(); ctx.arc(x - 5, y - 3, 4, 0, Math.PI * 2); ctx.arc(x + 5, y - 3, 4, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#11111b";
  ctx.beginPath(); ctx.arc(x - 5, y - 2, 2, 0, Math.PI * 2); ctx.arc(x + 5, y - 2, 2, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = "#11111b";
  ctx.lineWidth = 2;
  line(x - 10, y - 10, x - 2, y - 7);
  line(x + 10, y - 10, x + 2, y - 7);
  ctx.lineWidth = 1;
}

// Aura is made of simple shapes: ellipses for body and head, triangles for her spiky beard.
function drawAura(x, y, facing, goingUp) {
  ctx.save();
  ctx.translate(x + 20, y + 15);  // move the brush to Aura's middle
  ctx.scale(facing, 1);           // flip her to face the way she is running

  // Tail
  ctx.strokeStyle = COLORS.aura;
  ctx.lineWidth = 6;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-14, 2);
  ctx.quadraticCurveTo(-30, 4, -38, goingUp ? 14 : -6);
  ctx.stroke();

  // Legs: stretched down when jumping up, tucked when falling
  ctx.strokeStyle = COLORS.auraDark;
  ctx.lineWidth = 4;
  const legY = goingUp ? 16 : 10;
  line(-10, 6, -14, legY); line(8, 6, 12, legY);

  // Body
  ctx.fillStyle = COLORS.aura;
  ctx.beginPath(); ctx.ellipse(0, 0, 17, 10, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = COLORS.belly;
  ctx.beginPath(); ctx.ellipse(0, 5, 11, 4, 0, 0, Math.PI * 2); ctx.fill();

  // Spikes along her back
  ctx.fillStyle = COLORS.auraDark;
  for (let i = -10; i <= 8; i += 6) {
    ctx.beginPath(); ctx.moveTo(i, -8); ctx.lineTo(i + 3, -13); ctx.lineTo(i + 6, -8); ctx.fill();
  }

  // Head
  ctx.fillStyle = COLORS.aura;
  ctx.beginPath(); ctx.ellipse(17, -6, 10, 8, -0.2, 0, Math.PI * 2); ctx.fill();

  // Beard spikes under her chin
  ctx.fillStyle = COLORS.auraDark;
  for (let i = 10; i <= 20; i += 5) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + 2, 6); ctx.lineTo(i + 4, 0); ctx.fill();
  }

  // Eye
  ctx.fillStyle = "#11111b";
  ctx.beginPath(); ctx.arc(20, -8, 2.2, 0, Math.PI * 2); ctx.fill();

  ctx.restore();
  ctx.lineCap = "butt";
  ctx.lineWidth = 1;
}

function drawTitle() {
  if (photo.complete && photo.naturalWidth) {
    ctx.save();
    ctx.beginPath(); ctx.arc(W / 2, 160, 90, 0, Math.PI * 2); ctx.clip();  // round photo
    ctx.drawImage(photo, W / 2 - 90, 70, 180, 180);
    ctx.restore();
  }
  ctx.textAlign = "center";
  ctx.fillStyle = COLORS.aura;
  ctx.font = "bold 48px system-ui, sans-serif";
  ctx.fillText("Aura Jump", W / 2, 305);
  ctx.fillStyle = COLORS.belly;
  ctx.font = "italic 18px system-ui, sans-serif";
  ctx.fillText("Starring Aura the bearded dragon", W / 2, 335);

  ctx.fillStyle = COLORS.text;
  ctx.font = "bold 20px system-ui, sans-serif";
  ctx.fillText(isTouch ? "Tap to start" : "Tap or press Space to start", W / 2, 385);
  ctx.fillStyle = COLORS.muted;
  ctx.font = "15px system-ui, sans-serif";
  ctx.fillText(isTouch ? "Hold left or right side to steer" : "Arrow keys or A / D to steer", W / 2, 413);
  ctx.fillText(isTouch ? "Tap SPIT to shoot crickets at veggies" : "Up, W or Space spits crickets", W / 2, 435);
  ctx.fillText("Best: " + best, W / 2, 462);
  drawAura(W / 2 - 20, 482, 1, Math.sin(Date.now() / 200) > 0);

  // The credits
  ctx.fillStyle = COLORS.text;
  ctx.font = "bold 17px system-ui, sans-serif";
  ctx.fillText("Made by Bryce and Landon Holcomb", W / 2, 565);
}

function drawGameOver() {
  ctx.fillStyle = "rgba(17, 17, 27, 0.8)";
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = "center";
  ctx.fillStyle = COLORS.aura;
  ctx.font = "bold 36px system-ui, sans-serif";
  ctx.fillText(deathMessage, W / 2, 250);
  ctx.fillStyle = COLORS.text;
  ctx.font = "26px system-ui, sans-serif";
  ctx.fillText("Score: " + score, W / 2, 300);
  ctx.fillText("Best: " + best, W / 2, 340);
  ctx.font = "18px system-ui, sans-serif";
  ctx.fillText(isTouch ? "Tap to play again" : "Tap or press Space to play again", W / 2, 400);
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.fill();
}

// ---------- 7. THE GAME LOOP ----------
// The browser calls loop() before every screen refresh. Some screens refresh faster
// than others, so we count real time and run the rules exactly 60 times a second.
let last = performance.now(), spare = 0;
function loop(now) {
  spare = Math.min(spare + (now - last), 100);
  last = now;
  while (spare >= 1000 / 60) { update(); spare -= 1000 / 60; }
  draw();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
