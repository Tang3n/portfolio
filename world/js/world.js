import * as THREE from "three";
import {
    bake, mat, wind, jitter, rock, pine, bush, dock, islandMesh, mountainMesh, ISLAND_TOP,
    lighthouse, smartHome, school, containers, radioMast, preikestolen, kjerag,
} from "./models.js";

// Statický svět: ostrovy se sekcemi, hory kolem fjordu, skály, racci. Vrací
// - group:     vše k vykreslení
// - colliders: kružnice {x, z, r}, do kterých loď a bóje narážejí
// - zones:     {id, x, z, r} – kotviště; když je loď uvnitř, otevře se sekce
// - update(t): animace (značky kotvišť, světla, paprsek majáku, racci)
// Samotné modely jsou v models.js; tady se jen rozmisťují.

// Deterministický pseudo-náhodný generátor (mulberry32): svět vypadá při
// každém načtení stejně, takže se dá ladit a rozmístění je opakovatelné.
function rng(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// Rozmístění ostrovů. Loď startuje v (0, 0) přídí k −Z.
const ISLANDS = [
    { id: "about",      x: -36, z: -34, r: 13, build: lighthouse },
    { id: "experience", x:  40, z: -44, r: 14, build: smartHome },
    { id: "education",  x:  64, z:  18, r: 14, build: school },
    { id: "skills",     x: -60, z:  24, r: 13, build: containers },
    { id: "contact",    x:   2, z:  62, r: 11, build: radioMast },
];
const DOCK_LENGTH = 7;

// Zajímavá místa na okraji fjordu (nejsou to sekce, jen se k nim dá doplout).
const SIGHTS = [
    { id: "preikestolen", title: "Preikestolen", x: -10, z: -117, r: 9, build: preikestolen },
    { id: "kjerag", title: "Kjerag", x: 90, z: -86, r: 10, build: kjerag },
];

// Světelný kužel majáku: dva protilehlé kužely s aditivním shaderem, který
// slábne se vzdáleností od lampy. Aditivní = barva se přičítá k pozadí,
// takže to vypadá jako světlo v oparu, ne jako pevný objekt.
function lighthouseBeam() {
    const LENGTH = 38;
    const geo = new THREE.CylinderGeometry(0.3, 3.2, LENGTH, 14, 1, true);
    geo.translate(0, -LENGTH / 2, 0); // úzký konec do počátku
    geo.rotateZ(Math.PI / 2);         // osa kužele → +X
    const material = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        uniforms: { uColor: { value: new THREE.Color(0xffd27a) } },
        vertexShader: `
            varying float vAlong;
            void main() {
                vAlong = abs(position.x) / ${LENGTH.toFixed(1)};
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }`,
        fragmentShader: `
            uniform vec3 uColor;
            varying float vAlong;
            void main() {
                gl_FragColor = vec4(uColor, pow(1.0 - vAlong, 2.0) * 0.22);
            }`,
    });
    const beam = new THREE.Group();
    const back = new THREE.Mesh(geo, material);
    back.rotation.y = Math.PI;
    beam.add(new THREE.Mesh(geo, material), back);
    beam.rotation.z = -0.06;
    return beam;
}

function buildIsland(def, random) {
    // Vše statické na ostrově se staví do jedné skupiny v počátku a nakonec
    // upeče (bake) do pár sítí. Teprve pak se skupina posune na místo.
    const g = new THREE.Group();
    g.add(islandMesh(def.r, def.x * 1.7 + def.z));

    const landmark = def.build();
    landmark.position.y = ISLAND_TOP + 0.05;
    g.add(landmark);

    const toCenter = Math.atan2(-def.z, -def.x); // směr ke středu zálivu = kam míří molo
    const dx = Math.cos(toCenter);
    const dz = Math.sin(toCenter);

    // Stromy, keře a balvany po obvodu plošiny, mimo směr k molu.
    const ringSpot = (spread, dMin, dMax) => {
        const a = toCenter + Math.PI + (random() - 0.5) * spread;
        const d = def.r * (dMin + random() * (dMax - dMin));
        return [Math.cos(a) * d, Math.sin(a) * d];
    };
    const trees = 7 + Math.floor(random() * 4);
    for (let i = 0; i < trees; i++) {
        const [x, z] = ringSpot(Math.PI * 1.25, 0.5, 0.68);
        const tree = pine(0.7 + random() * 0.55, random);
        tree.position.set(x, 1.3, z);
        g.add(tree);
    }
    for (let i = 0; i < 6; i++) {
        const [x, z] = ringSpot(Math.PI * 1.7, 0.45, 0.74);
        const b = bush(random);
        b.position.x = x;
        b.position.z = z;
        b.position.y += 1.2;
        g.add(b);
    }
    for (let i = 0; i < 4; i++) {
        const [x, z] = ringSpot(Math.PI * 1.9, 0.8, 0.98);
        const r = 0.35 + random() * 0.55;
        const stone = rock(r, random() * 99);
        stone.position.set(x, 0.3, z);
        g.add(stone);
    }

    // Molo míří ke středu zálivu; na jeho konci je kotviště (zóna).
    const pier = dock(DOCK_LENGTH);
    const dockStart = def.r - 2.5;
    pier.position.set(dx * dockStart, 0, dz * dockStart);
    pier.rotation.y = -toCenter;
    g.add(pier);

    bake(g);

    // Po upečení: díly, které se hýbou nebo svítí zvlášť.
    let beam = null;
    if (landmark.userData.lamp) {
        beam = lighthouseBeam();
        beam.position.y = ISLAND_TOP + 0.05 + landmark.userData.lampHeight;
        g.add(beam);
        const glow = new THREE.PointLight(0xffc266, 90, 34); // osvítí ostrov kolem lampy
        glow.position.y = beam.position.y;
        g.add(glow);
    }
    g.position.set(def.x, 0, def.z);

    // Molo je úzký obdélník; pro kolize ho nahradíme třemi malými kružnicemi
    // v ose mola – stačí to a nepotřebujeme druhý typ kolizního tvaru.
    const dockColliders = [0.35, 0.65, 0.95].map((along) => {
        const d = dockStart + DOCK_LENGTH * along;
        return { x: def.x + dx * d, z: def.z + dz * d, r: 1.1 };
    });

    const zoneDist = def.r + DOCK_LENGTH + 1.5;
    return {
        group: g,
        beam,
        lamp: landmark.userData.lamp ?? null,
        mastLight: landmark.userData.light ?? null,
        colliders: [{ x: def.x, z: def.z, r: def.r * 1.02 }, ...dockColliders],
        zone: { id: def.id, x: def.x + dx * zoneDist, z: def.z + dz * zoneDist, r: 9.5 },
        labelPos: new THREE.Vector3(def.x, 15.5, def.z),
    };
}

function buildMountains(random, colliders) {
    const g = new THREE.Group();
    const COUNT = 24;
    for (let i = 0; i < COUNT; i++) {
        const a = (i / COUNT) * Math.PI * 2 + (random() - 0.5) * 0.12;
        const dist = 152 + random() * 14;
        const r = 34 + random() * 14;
        const h = 45 + random() * 50;
        const x = Math.cos(a) * dist;
        const z = Math.sin(a) * dist;
        const m = mountainMesh(r, h, i * 7.3);
        m.position.set(x, 0, z);
        g.add(m);
        colliders.push({ x, z, r: r * 0.86 });

        // Les na úpatí směrem do zálivu: jednoduché kužely (bez větru – jsou daleko).
        const inward = Math.atan2(-z, -x);
        for (let k = 0; k < 9; k++) {
            const ta = inward + (random() - 0.5) * 1.5;
            const f = 0.82 + random() * 0.12; // jak daleko od osy hory (0 = vrchol, 1 = pata)
            const size = 1.6 + random() * 1.4;
            const tree = new THREE.Mesh(new THREE.ConeGeometry(size, size * 3, 5), mat(random() > 0.5 ? 0x2f5d45 : 0x284f3b));
            tree.position.set(x + Math.cos(ta) * r * f, h * (1 - f) - 3 + size * 1.1, z + Math.sin(ta) * r * f);
            g.add(tree);
        }
    }
    bake(g);
    // Hory stín nevrhají ani nepřijímají: jsou mimo dosah stínové mapy.
    g.traverse((o) => {
        if (o.isMesh) o.castShadow = o.receiveShadow = false;
    });
    return g;
}

function buildRocks(random, colliders) {
    const g = new THREE.Group();
    const spots = [[-12, -62], [-2, -46], [-78, -18], [30, 40], [-30, 52], [84, -30], [-22, 8]];
    for (const [x, z] of spots) {
        const r = 1.7 + random() * 1.6;
        const main = rock(r, x);
        main.position.set(x, r * 0.12, z);
        main.rotation.y = random() * 6;
        g.add(main);
        colliders.push({ x, z, r: r * 0.9 });
        // menší kameny přilepené k hlavnímu – útes místo osamělého balvanu
        for (let k = 0; k < 2 + Math.floor(random() * 2); k++) {
            const a = random() * Math.PI * 2;
            const sr = r * (0.3 + random() * 0.25);
            const small = rock(sr, x + k);
            small.position.set(x + Math.cos(a) * r * 0.95, sr * 0.1 - 0.1, z + Math.sin(a) * r * 0.95);
            g.add(small);
        }
    }
    return bake(g);
}

// Racci krouží kolem daného bodu. Každý je tělo + dvě křídla, která se
// otáčejí kolem osy těla (mávání); poloha je bod na kružnici.
function buildBirds(center, count, random) {
    const g = new THREE.Group();
    const white = new THREE.MeshLambertMaterial({ color: 0xf7f7f2, flatShading: true, side: THREE.DoubleSide });
    const wingGeo = new THREE.BufferGeometry();
    wingGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array([0, 0, 0.22, 0, 0, -0.18, 1.1, 0, -0.05]), 3));
    wingGeo.computeVertexNormals();
    const birds = [];
    for (let i = 0; i < count; i++) {
        const bird = new THREE.Group();
        const body = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.7, 5), white);
        body.rotation.x = Math.PI / 2;
        const left = new THREE.Mesh(wingGeo, white);
        const right = new THREE.Mesh(wingGeo, white);
        right.scale.x = -1;
        bird.add(body, left, right);
        g.add(bird);
        birds.push({
            bird, left, right,
            radius: 7 + random() * 12, height: 14 + random() * 7,
            speed: (0.25 + random() * 0.25) * (random() > 0.5 ? 1 : -1),
            phase: random() * 10, flap: 6 + random() * 3,
        });
    }
    function update(t) {
        for (const b of birds) {
            const a = b.phase + t * b.speed;
            b.bird.position.set(center.x + Math.cos(a) * b.radius, b.height + Math.sin(t * 0.7 + b.phase) * 1.2, center.z + Math.sin(a) * b.radius);
            b.bird.rotation.y = -a + (b.speed > 0 ? 0 : Math.PI); // čelem ve směru letu (tečna kružnice)
            const w = Math.sin(t * b.flap + b.phase) * 0.55;
            b.left.rotation.z = w;
            b.right.rotation.z = -w;
        }
    }
    return { group: g, update };
}

// Cedule nad ostrovem: text vykreslený do 2D canvasu a použitý jako textura
// na Sprite (čtverec, který se vždy natáčí ke kameře).
function makeLabel(text) {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    const font = '600 64px "Inter", system-ui, sans-serif';
    ctx.font = font;
    const padX = 44;
    const w = Math.ceil(ctx.measureText(text).width) + padX * 2;
    const h = 120;
    canvas.width = w;
    canvas.height = h;
    ctx.font = font; // změna rozměrů canvasu resetuje stav kontextu
    ctx.fillStyle = "rgba(24, 24, 27, 0.86)";
    ctx.beginPath();
    ctx.roundRect(0, 0, w, h, 60);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    ctx.fillText(text, w / 2, h / 2 + 4);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    // sizeAttenuation: false → cedule má stálou velikost na obrazovce bez ohledu
    // na vzdálenost od kamery (chová se jako UI, ne jako objekt ve světě).
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, fog: false, sizeAttenuation: false, toneMapped: false }));
    const height = 0.05;
    sprite.scale.set((w / h) * height, height, 1);
    sprite.renderOrder = 10;
    return sprite;
}

export function createWorld(sections, { calm = false } = {}) {
    const group = new THREE.Group();
    const colliders = [];
    const zones = [];
    const markers = [];
    const labels = {};
    const random = rng(20261118);
    let beam = null;
    let mastLight = null;

    const titles = Object.fromEntries(sections.map((s) => [s.id, s.title]));

    for (const def of ISLANDS) {
        const island = buildIsland(def, random);
        group.add(island.group);
        colliders.push(...island.colliders);
        zones.push(island.zone);

        const label = makeLabel(titles[def.id] ?? def.id);
        label.position.copy(island.labelPos);
        group.add(label);
        labels[def.id] = label;

        // Značka kotviště: kruh na hladině.
        const ring = new THREE.Mesh(
            new THREE.RingGeometry(island.zone.r - 0.35, island.zone.r, 48),
            new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide })
        );
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(island.zone.x, 0.75, island.zone.z);
        ring.renderOrder = 2; // až po vodě (obě jsou průhledné)
        group.add(ring);
        markers.push({ ring, id: def.id });

        beam = island.beam ?? beam;
        mastLight = island.mastLight ?? mastLight;
    }

    for (const sight of SIGHTS) {
        const model = sight.build();
        model.position.set(sight.x, 0, sight.z);
        model.rotation.y = Math.atan2(-sight.x, -sight.z); // čelem ke středu zálivu
        group.add(model);
        colliders.push({ x: sight.x, z: sight.z, r: sight.r });
        const label = makeLabel(sight.title);
        label.scale.multiplyScalar(0.75);
        label.position.set(sight.x, 31, sight.z);
        group.add(label);
    }

    group.add(buildMountains(random, colliders));
    group.add(buildRocks(random, colliders));
    const birds = buildBirds(ISLANDS[0], 7, random);
    group.add(birds.group);

    function update(t, activeId) {
        for (const m of markers) {
            const active = m.id === activeId;
            m.ring.material.opacity = active ? 0.9 : 0.3 + 0.15 * Math.sin(t * 2);
            m.ring.material.color.set(active ? 0xb794f6 : 0xffffff);
        }
        wind.uTime.value = t;
        birds.update(t);
        // calm = „omezit pohyb“: paprsek se netočí a světlo nebliká
        if (beam && !calm) beam.rotation.y = t * 0.5;
        if (mastLight && !calm) mastLight.material.emissiveIntensity = Math.sin(t * 3) > 0.3 ? 7 : 0.2;
    }

    return { group, colliders, zones, islands: ISLANDS, sights: SIGHTS, labels, update };
}
