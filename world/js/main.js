import * as THREE from "three";
import { EffectComposer } from "../vendor/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "../vendor/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "../vendor/addons/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "../vendor/addons/postprocessing/ShaderPass.js";
import { OutputPass } from "../vendor/addons/postprocessing/OutputPass.js";
import { content } from "./content.js";
import { createInput } from "./input.js";
import { createRipples } from "./ripples.js";
import { createWater } from "./water.js";
import { createSky } from "./sky.js";
import { createBoat, BOAT_RADIUS } from "./boat.js";
import { createWorld } from "./world.js";
import { createBuoys, createSpray, resolveStatic } from "./floaters.js";

// ---------------------------------------------------------------------------
// Jazyk a DOM
// ---------------------------------------------------------------------------
const lang = new URLSearchParams(location.search).get("lang") === "cs" ? "cs" : "en";
const { ui, sections } = content[lang];
document.documentElement.lang = lang;
document.title = ui.title;

const $ = (id) => document.getElementById(id);
const canvas = $("scene");
const panel = $("panel");
const panelTitle = $("panel-title");
const panelBody = $("panel-body");

$("role").textContent = ui.role;
$("intro-role").textContent = ui.role;
$("intro-lede").textContent = ui.introLede;
$("intro-sail").textContent = ui.sail;
$("intro-reset").textContent = ui.reset;
// Tlačítko je zamčené, dokud není scéna postavená a shadery zkompilované.
$("start").textContent = ui.loading;
$("start").disabled = true;
$("scene-help").textContent = ui.sceneHelp;
const hud = document.querySelector(".hud");
hud.inert = true; // před startem je lišta neviditelná → nesmí jít ani zaměřit klávesnicí
const loadBar = $("load-bar");
// Posune ukazatel a počká na další snímek, aby ho prohlížeč stihl vykreslit
// (stavba scény je synchronní; bez téhle pauzy by se pruh nikdy nepřekreslil).
const progress = (p) => {
    loadBar.style.transform = `scaleX(${p})`;
    return new Promise((resolve) => requestAnimationFrame(resolve));
};
const timing = { start: performance.now() };
// Uživatelé se zapnutým „omezit pohyb“: menší vlny, kamera nepředbíhá, nic nebliká.
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
$("unit").textContent = ui.unit;
$("panel-close").setAttribute("aria-label", ui.close);
$("panel-prev").setAttribute("aria-label", ui.prev);
$("panel-next").setAttribute("aria-label", ui.next);
$("nav").setAttribute("aria-label", ui.sections);
for (const el of document.querySelectorAll("[data-classic]")) {
    el.textContent = ui.classic;
    el.href = ui.classicHref;
}
const langLink = $("lang");
langLink.textContent = ui.langLabel;
langLink.href = ui.langHref;

// localStorage může být zakázané (soukromé okno) → vždy v try/catch.
const store = {
    get(key, fallback) {
        try { return JSON.parse(localStorage.getItem(`world:${key}`)) ?? fallback; } catch { return fallback; }
    },
    set(key, value) {
        try { localStorage.setItem(`world:${key}`, JSON.stringify(value)); } catch { /* bez úložiště se jen nic nezapamatuje */ }
    },
};

// --- Stav rozhraní -----------------------------------------------------------
// Panel sekce má dva zdroje:
//  - loď vpluje do kotviště  → activeZone
//  - klik v navigaci         → pinned (drží, dokud ho uživatel nezavře) a zároveň
//                              waypoint: šipka, která k ostrovu navádí
// Navigace je tak i přístupná cesta k obsahu bez řízení lodi.
let activeZone = null;
let pinned = null;
let dismissed = null; // zóna zavřená křížkem, dokud z ní loď nevypluje
let shown = null;
let waypoint = null;
const visited = new Set(store.get("visited", []).filter((id) => sections.some((s) => s.id === id)));

function renderPanel() {
    const id = pinned ?? (activeZone !== dismissed ? activeZone : null);
    if (id === shown) return;
    shown = id;
    const index = sections.findIndex((s) => s.id === id);
    const section = sections[index];
    panel.classList.toggle("open", Boolean(section));
    panel.inert = !section; // zavřený panel je mimo pořadí Tab i mimo čtečku
    for (const b of document.querySelectorAll("#nav button")) {
        b.setAttribute("aria-current", b.dataset.id === id ? "true" : "false");
    }
    if (section) {
        $("panel-index").textContent = `${String(index + 1).padStart(2, "0")} / ${String(sections.length).padStart(2, "0")}`;
        panelTitle.textContent = section.title;
        panelBody.innerHTML = section.html; // obsah je náš vlastní statický text z content.js
        panelBody.scrollTop = 0;
    }
}

function renderProgress() {
    $("progress").textContent = `${visited.size}/${sections.length}`;
    $("progress").title = `${visited.size}/${sections.length} ${ui.visited}`;
    for (const b of document.querySelectorAll("#nav button")) {
        b.classList.toggle("visited", visited.has(b.dataset.id));
    }
}

// focus: true → po otevření přesune fokus na nadpis panelu (ovládání z klávesnice
// a čtečky). Při připlutí lodí se fokus NEPŘESOUVÁ – hráč právě řídí.
function pin(id, { focus = false } = {}) {
    const wasClosed = !shown;
    pinned = id;
    waypoint = id && id !== activeZone ? id : null;
    renderPanel();
    if (id && focus && wasClosed) panelTitle.focus();
}

for (const s of sections) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = s.title;
    b.dataset.id = s.id;
    b.addEventListener("click", () => pin(pinned === s.id ? null : s.id, { focus: true }));
    $("nav").append(b);
}
renderProgress();

function closePanel() {
    // Fokus uvnitř panelu by po zavření zmizel „do prázdna“ → vrátíme ho na
    // tlačítko sekce, ze které se panel otevřel.
    const returnTo = panel.contains(document.activeElement) ? document.querySelector(`#nav button[data-id="${shown}"]`) : null;
    pinned = null;
    waypoint = null;
    dismissed = activeZone;
    renderPanel();
    returnTo?.focus();
}
function stepSection(delta) {
    const i = sections.findIndex((s) => s.id === shown);
    pin(sections[(i + delta + sections.length) % sections.length].id);
}
$("panel-close").addEventListener("click", closePanel);
$("panel-prev").addEventListener("click", () => stepSection(-1));
$("panel-next").addEventListener("click", () => stepSection(1));

// Toast: krátká zpráva dole, volitelně s tlačítkem.
let toastTimer = 0;
function toast(text, action) {
    const el = $("toast");
    el.replaceChildren(text);
    if (action) {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = action.label;
        b.addEventListener("click", () => { el.hidden = true; action.run(); });
        el.append(b);
    }
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 9000);
}

// Kontextová nápověda: zobrazí se jen při změně textu (žádné přepisování DOM každý snímek).
let promptKey = "";
function setPrompt(key, html) {
    if (key === promptKey) return;
    promptKey = key;
    const el = $("prompt");
    el.innerHTML = html;
    el.classList.toggle("show", Boolean(html));
}
// Zápis do DOM jen když se hodnota změní.
const lastText = new Map();
function setText(id, value) {
    if (lastText.get(id) === value) return;
    lastText.set(id, value);
    $(id).textContent = value;
}

// ---------------------------------------------------------------------------
// Scéna
// ---------------------------------------------------------------------------
let renderer;
try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
} catch {
    $("intro-lede").textContent = ui.noWebgl;
    $("start").hidden = true;
    throw new Error("WebGL unavailable");
}
const PIXEL_RATIO = Math.min(window.devicePixelRatio, 2); // nad 2× už jen pálí GPU
renderer.setPixelRatio(PIXEL_RATIO);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
// Scéna se počítá v lineárním HDR (hodnoty i nad 1,0). Tone mapping je křivka,
// která ten rozsah na konci stlačí do 0..1 pro monitor – ACES dělá měkké
// přepaly místo ořezu do bílé.
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

// Zlatá hodina: nízké teplé slunce zprava a lehce zezadu (stěny otočené ke kameře jsou osvětlené), chladnější světlo z oblohy.
const HORIZON = 0xf3cfa6;
const ZENITH = 0x4b8ccb;
const SUN_COLOR = 0xffc78f;
const SUN_OFFSET = new THREE.Vector3(85, 44, 32);

const scene = new THREE.Scene();
// Mlha v barvě obzoru: vzdálené hory blednou a okraj vodní sítě není vidět.
scene.fog = new THREE.Fog(HORIZON, 110, 360);

const camera = new THREE.PerspectiveCamera(46, 1, 1, 900);
// Kamera drží stálý směr pohledu a jen se posouvá s lodí, takže „nahoru na
// obrazovce“ znamená pořád stejný světový směr.
const CAM_OFFSET = new THREE.Vector3(0, 23, 60);
const camTarget = new THREE.Vector3();

scene.add(new THREE.HemisphereLight(0xbcd8ff, 0x6a5a4a, 1.45));
const sun = new THREE.DirectionalLight(SUN_COLOR, 3.4);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
// Stínová kamera je ortografická krabice; držíme ji kolem lodi, aby
// rozlišení stínové mapy pokrývalo jen to, co je vidět.
Object.assign(sun.shadow.camera, { left: -95, right: 95, top: 95, bottom: -95, near: 1, far: 300 });
sun.shadow.bias = -0.0015;
scene.add(sun, sun.target);

// Cedule nad ostrovy se kreslí do canvasu fontem Inter. Canvas na rozdíl od
// HTML nepřekreslí text, když font dorazí později, takže na něj počkáme
// (nejdéle 1,5 s – pak se použije systémový font).
await progress(0.1);
await Promise.race([
    document.fonts.load('600 64px "Inter"', "Štěpán"),
    new Promise((resolve) => setTimeout(resolve, 1500)),
]);
await progress(0.25);
timing.fonts = performance.now();

// Pořadí stavby: svět (dá kolizní kružnice) → mřížka vln (potřebuje vědět,
// kde je pevnina) → hladina (čte texturu z mřížky).
const world = createWorld(sections, { calm: reducedMotion });
timing.world = performance.now();
await progress(0.6);
const ripples = createRipples(world.colliders);
const water = createWater(ripples, { sky: 0x9cc3e6, swell: reducedMotion ? 0.35 : 1 });
const sky = createSky({ horizon: HORIZON, zenith: ZENITH, sunColor: SUN_COLOR, sunDir: SUN_OFFSET });
const boat = createBoat();
const buoys = createBuoys(world.colliders);
const spray = createSpray();
scene.add(sky.mesh, water.mesh, world.group, buoys.group, boat.mesh, spray.points);
timing.scene = performance.now();
await progress(0.8);

// --- Postprocessing ---------------------------------------------------------
// Scéna se nekreslí rovnou na obrazovku, ale do HDR textury, a ta projde
// řetězem průchodů:
//   RenderPass  → scéna do textury (s MSAA, proto je antialias na rendereru vypnutý)
//   Bloom       → co je jasnější než práh (okna, lampa, odlesky slunce), se rozmaže a přičte
//   Grade       → lehce vyšší sytost a vignette
//   OutputPass  → tone mapping + převod do sRGB
const composer = new EffectComposer(
    renderer,
    new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 })
);
composer.setPixelRatio(PIXEL_RATIO);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.28, 0.55, 1.7);
composer.addPass(bloom);
composer.addPass(new ShaderPass({
    uniforms: { tDiffuse: { value: null } },
    vertexShader: `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
        uniform sampler2D tDiffuse;
        varying vec2 vUv;
        void main() {
            vec4 c = texture2D(tDiffuse, vUv);
            float luma = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
            c.rgb = mix(vec3(luma), c.rgb, 1.12);   // sytost
            vec2 q = vUv - 0.5;
            c.rgb *= 1.0 - dot(q, q) * 0.6;         // vignette: tmavší rohy
            gl_FragColor = c;
        }`,
}));
composer.addPass(new OutputPass());

// --- Kvalita ---------------------------------------------------------------
// „low“ vypne to nejdražší: stíny, bloom a vykreslování nad 1× hustotu pixelů.
let quality = store.get("quality", "high");
function applyQuality() {
    const high = quality === "high";
    const ratio = high ? PIXEL_RATIO : 1;
    renderer.setPixelRatio(ratio);
    composer.setPixelRatio(ratio);
    bloom.enabled = high;
    sun.castShadow = high;
    $("quality").textContent = high ? ui.qualityHigh : ui.qualityLow;
    resize();
}
$("quality").addEventListener("click", () => {
    quality = quality === "high" ? "low" : "high";
    store.set("quality", quality);
    fpsWatch.done = true; // uživatel si vybral sám, už nepřepínat automaticky
    applyQuality();
});
// Hlídač FPS: pokud prvních pár sekund plavby běží pod 28 FPS, přepne na low.
const fpsWatch = { frames: 0, time: 0, done: quality === "low" };

const input = createInput(canvas, $("stick"));

function resetBoat() {
    Object.assign(boat.state, { x: 0, z: 0, vx: 0, vz: 0, y: 0, vy: 0, pitch: 0, roll: 0, pitchV: 0, rollV: 0, heading: Math.PI });
}
window.addEventListener("keydown", (e) => {
    if (e.code === "Escape") closePanel();
    if (e.code === "KeyR" && !e.ctrlKey && !e.metaKey) resetBoat();
});
const WORLD_LIMIT = 132; // pojistka za horami

function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    // Bloom v polovičním rozlišení: je to rozmazání, takže na ostrosti nezáleží,
    // a právě bloom byl podle měření nejdražší část snímku na GPU.
    const ratio = renderer.getPixelRatio();
    bloom.setSize((w * ratio) / 2, (h * ratio) / 2);
    camera.aspect = w / h;
    // Na výšku (mobil) kameru oddálíme, aby se ostrovy vešly do šířky.
    camera.userData.zoom = Math.max(1, 1.25 / camera.aspect);
    camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);
applyQuality(); // nastaví hustotu pixelů a zavolá resize()

// --- Minimapa (2D canvas, pohled shora; sever = −Z = nahoře jako na obrazovce)
const map = $("minimap");
const mapCtx = map.getContext("2d");
const MAP_PX = 132;
map.width = map.height = MAP_PX * 2; // 2× kvůli ostrosti na HiDPI
function drawMinimap(s, activeId) {
    const k = (MAP_PX * 2) / (WORLD_LIMIT * 2 + 16);
    const c = MAP_PX;
    const X = (x) => c + x * k;
    mapCtx.clearRect(0, 0, map.width, map.height);
    // spojnice k vybranému ostrovu
    const target = world.zones.find((z) => z.id === waypoint);
    if (target) {
        mapCtx.setLineDash([6, 6]);
        mapCtx.strokeStyle = "rgba(196, 181, 253, 0.9)";
        mapCtx.lineWidth = 2;
        mapCtx.beginPath();
        mapCtx.moveTo(X(s.x), X(s.z));
        mapCtx.lineTo(X(target.x), X(target.z));
        mapCtx.stroke();
        mapCtx.setLineDash([]);
    }
    for (const isl of world.islands) {
        mapCtx.beginPath();
        mapCtx.arc(X(isl.x), X(isl.z), isl.r * k, 0, Math.PI * 2);
        mapCtx.fillStyle = isl.id === activeId || isl.id === waypoint ? "#c4b5fd" : visited.has(isl.id) ? "#8fc47a" : "rgba(255,255,255,0.55)";
        mapCtx.fill();
    }
    for (const p of world.sights) { // skály jako malé trojúhelníky
        mapCtx.beginPath();
        mapCtx.moveTo(X(p.x), X(p.z) - 9);
        mapCtx.lineTo(X(p.x) + 8, X(p.z) + 6);
        mapCtx.lineTo(X(p.x) - 8, X(p.z) + 6);
        mapCtx.closePath();
        mapCtx.fillStyle = "rgba(255,255,255,0.75)";
        mapCtx.fill();
    }
    mapCtx.fillStyle = "rgba(255,255,255,0.7)";
    mapCtx.font = "600 20px Inter, sans-serif";
    mapCtx.textAlign = "center";
    mapCtx.fillText(ui.compass[0], c, 24);
    mapCtx.save();
    mapCtx.translate(X(s.x), X(s.z));
    mapCtx.rotate(-s.heading); // heading roste proti směru hodin, canvas po směru
    mapCtx.beginPath();
    mapCtx.moveTo(0, 14);
    mapCtx.lineTo(8, -9);
    mapCtx.lineTo(0, -4);
    mapCtx.lineTo(-8, -9);
    mapCtx.closePath();
    mapCtx.fillStyle = "#fff";
    mapCtx.fill();
    mapCtx.restore();
}

// Přístroje a nápověda. Kamera má pevný směr, takže světový směr −Z (sever)
// je na obrazovce vždy nahoře a úhel šipky jde spočítat přímo ze světa.
const titleOf = Object.fromEntries(sections.map((sec) => [sec.id, sec.title]));
let sailed = 0;
function updateHud(s, dt) {
    const fx = Math.sin(s.heading), fz = Math.cos(s.heading);
    const bearing = (Math.atan2(fx, -fz) * 180 / Math.PI + 360) % 360; // 0° = sever, po směru hodin
    setText("speed", String(Math.round(Math.abs(s.speed) * 1.94)));
    setText("heading", ui.compass[Math.round(bearing / 45) % 8]);
    $("needle").style.transform = `rotate(${bearing.toFixed(0)}deg)`;

    const target = world.zones.find((z) => z.id === waypoint);
    $("waypoint").hidden = !target;
    if (target) {
        const dx = target.x - s.x, dz = target.z - s.z;
        $("waypoint-arrow").style.transform = `rotate(${(Math.atan2(dx, -dz) * 180 / Math.PI).toFixed(0)}deg)`;
        setText("waypoint-text", `${titleOf[target.id]} · ${Math.round(Math.hypot(dx, dz))} m`);
    }

    sailed += Math.hypot(s.vx, s.vz) * dt;
    let near = null;
    for (const z of world.zones) {
        if (z.id !== activeZone && Math.hypot(s.x - z.x, s.z - z.z) < z.r + 16) near = z.id;
    }
    const sight = world.sights.find((p) => Math.hypot(s.x - p.x, s.z - p.z) < p.r + 26);
    if (activeZone) setPrompt(`in:${activeZone}`, `<b>⚓ ${ui.docked}</b> ${titleOf[activeZone]}`);
    else if (near) setPrompt(`near:${near}`, `<b>${titleOf[near]}</b> ${ui.approach}`);
    else if (sight) setPrompt(`sight:${sight.id}`, `<b>${sight.title}</b> ${ui.sights[sight.id]}`);
    else if (started && sailed < 25) setPrompt("keys", `<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> ${ui.sail} <span class="sep"></span> <kbd>R</kbd> ${ui.reset} <span class="sep touch"></span> <span class="touch">${ui.dragHint}</span>`);
    else setPrompt("", "");

    // hlídač FPS (jen prvních pár sekund po startu)
    if (started && !fpsWatch.done) {
        fpsWatch.frames++;
        fpsWatch.time += dt;
        if (fpsWatch.time > 5) {
            fpsWatch.done = true;
            if (fpsWatch.frames / fpsWatch.time < 28) {
                quality = "low";
                applyQuality();
                toast(ui.qualityAuto);
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Smyčka
// ---------------------------------------------------------------------------
// Fyzika běží s PEVNÝM krokem 1/60 s, nezávisle na tom, jak rychle se kreslí.
// Čas snímku se sype do „akumulátoru“ a odebírá se po celých krocích. Důvod:
// pružiny vztlaku i vlnová rovnice jsou stabilní jen pro malý krok, a s pevným
// krokem se simulace chová stejně na 60 Hz i 144 Hz monitoru.
const STEP = 1 / 60;
const MAX_STEPS = 4; // když prohlížeč nestíhá, simulace zpomalí, ale nezahltí se
let accumulator = 0;
let started = false;
let time = 0;
let last = performance.now();
let controls = { throttle: 0, steer: 0 };

function simulate(dt) {
    time += dt;
    water.update(time); // nastaví čas, pro který heightAt() počítá hladinu
    const s = boat.state;
    const vyBefore = s.vy;

    // 1) loď: vztlak, tah, kormidlo, a zpětně poruchy do mřížky vln
    boat.step(dt, controls, water.heightAt, ripples);
    if (vyBefore < -2.2 && s.vy > vyBefore * 0.7 && s.wet > 0.5) spray.burst(s.x, s.y, s.z, Math.min(1.5, -vyBefore / 3));

    // 2) kolize: loď × pevnina, loď × bóje, okraj světa
    if (resolveStatic(s, BOAT_RADIUS, world.colliders, 0.25)) {
        // tření trupu o břeh čeří vodu
        ripples.splat(s.x, s.z, 0.006 * Math.hypot(s.vx, s.vz), 0.04);
    }
    buoys.step(dt, s, water.heightAt);
    const dist = Math.hypot(s.x, s.z);
    if (dist > WORLD_LIMIT) {
        const nx = s.x / dist, nz = s.z / dist;
        s.x = nx * WORLD_LIMIT;
        s.z = nz * WORLD_LIMIT;
        const vn = s.vx * nx + s.vz * nz;
        if (vn > 0) { s.vx -= vn * nx; s.vz -= vn * nz; }
    }

    // 3) vlnová rovnice: rozšíří všechny poruchy o krok dál
    ripples.step(dt);
}

function update(dt) {
    const s = boat.state;
    controls = started ? input.read() : { throttle: 0, steer: 0 };

    accumulator += dt;
    let steps = 0;
    while (accumulator >= STEP && steps < MAX_STEPS) {
        simulate(STEP);
        accumulator -= STEP;
        steps++;
    }
    if (steps === MAX_STEPS) accumulator = 0;

    // zóny: která kotviště obsahují loď
    let zone = null;
    for (const z of world.zones) {
        if (Math.hypot(s.x - z.x, s.z - z.z) < z.r) zone = z.id;
    }
    if (zone !== activeZone) {
        activeZone = zone;
        dismissed = null;
        if (zone) {
            pinned = null; // připlutí má přednost před připnutou sekcí
            if (zone === waypoint) waypoint = null;
            if (!visited.has(zone)) {
                visited.add(zone);
                store.set("visited", [...visited]);
                renderProgress();
                if (visited.size === sections.length) {
                    toast(ui.allSeen, { label: ui.allSeenCta, run: () => pin("contact", { focus: true }) });
                }
            }
        }
        renderPanel();
    }
    updateHud(s, dt);

    // stav → grafika
    ripples.upload();
    boat.sync();
    buoys.sync();
    spray.update(dt, s);
    world.update(time, shown);
    sky.uniforms.uTime.value = time;
    drawMinimap(s, shown);

    // kamera: cíl je kousek před lodí ve směru jízdy, dojíždí se vyhlazeně.
    // 1 − exp(−k·dt) je vyhlazení nezávislé na FPS.
    const k = 1 - Math.exp(-3.5 * dt);
    const lead = reducedMotion ? 0 : 0.7; // o kolik sekund jízdy kamera loď předbíhá
    camTarget.x += (s.x + s.vx * lead - camTarget.x) * k;
    camTarget.z += (s.z + s.vz * lead - camTarget.z) * k;
    camera.position.copy(CAM_OFFSET).multiplyScalar(camera.userData.zoom).add(camTarget);
    camera.lookAt(camTarget.x, 2, camTarget.z);
    sky.mesh.position.copy(camera.position);

    sun.target.position.copy(camTarget);
    sun.position.copy(camTarget).add(SUN_OFFSET);
}

function frame(now) {
    // dt omezíme: po přepnutí záložky by jinak přišel jeden obří skok.
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    update(dt);
    composer.render();
    requestAnimationFrame(frame);
}

function start() {
    if (started) return;
    started = true;
    document.body.classList.add("started");
    $("intro").inert = true;
    hud.inert = false;
    canvas.focus();
}
$("start").addEventListener("click", start);

// Zahřívací snímek: první vykreslení kompiluje všechny shadery a nahrává
// geometrii na GPU, což na chvíli zasekne. Uděláme to ještě pod úvodní kartou,
// aby se zásek neprojevil až po kliknutí na Start.
update(0);
composer.render();
timing.firstFrame = performance.now();
await progress(1);
document.body.classList.add("ready");
$("start").textContent = ui.start;
$("start").disabled = false;
$("start").focus({ preventScroll: true });

requestAnimationFrame((now) => {
    last = now;
    frame(now);
});

// Pro ladění z konzole: __world.boat.state
window.__world = { boat, scene, camera, ripples, renderer, composer, bloom, sun, water, timing };
