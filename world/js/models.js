import * as THREE from "three";
import { mergeGeometries } from "../vendor/addons/utils/BufferGeometryUtils.js";

// Procedurální modely. Všechno se skládá z primitiv (kvádr, válec, kužel,
// vytažený profil) přímo v kódu – žádné stažené soubory s modely.
//
// Detailní model = desítky malých dílů. Kdyby byl každý díl vlastní Mesh, GPU
// by dostalo stovky vykreslovacích příkazů (draw calls) za snímek. Proto se
// hotový model na konci „upeče“ funkcí bake(): geometrie všech statických
// dílů se sloučí do JEDNÉ sítě a barva dílu se zapíše do vrcholů.

const UP = new THREE.Vector3(0, 1, 0);

// --- Materiály ---------------------------------------------------------------
// Obyčejné barevné díly sdílejí materiál podle barvy a jsou označené k upečení.
const plain = new Map();
export function mat(color, extra) {
    if (extra) return new THREE.MeshLambertMaterial({ color, flatShading: true, ...extra });
    if (!plain.has(color)) {
        const m = new THREE.MeshLambertMaterial({ color, flatShading: true });
        m.userData.bake = true;
        plain.set(color, m);
    }
    return plain.get(color);
}

// Materiál upečených sítí: barvu bere z vrcholů.
const BAKED = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
BAKED.userData.bake = true;

// Svítící materiály. „merge“ = díly se stejným materiálem se sloučí do jedné
// sítě, ale materiál si nechají (emise nejde zapsat do barvy vrcholu).
const glowing = (color, emissive, intensity) => {
    const m = mat(color, { emissive, emissiveIntensity: intensity });
    m.userData.merge = true;
    return m;
};
const WINDOW = glowing(0xffe9a8, 0xffb347, 3.5);
const LAMP = glowing(0xfff3c4, 0xffc766, 4.5);
const GLASS = mat(0x1c3344);

// Jehličí s větrem: posun vrcholu ve vertex shaderu. Fáze závisí na poloze ve
// světě (stromy se nekývají synchronně), amplituda roste s výškou nad zemí.
export const wind = { uTime: { value: 0 } };
const NEEDLES = [0x2f6b4f, 0x27603f, 0x3a7a55].map((color) => {
    const m = mat(color, {});
    m.userData.merge = true;
    m.onBeforeCompile = (shader) => {
        shader.uniforms.uTime = wind.uTime;
        shader.vertexShader = shader.vertexShader
            .replace("#include <common>", "#include <common>\nuniform float uTime;")
            .replace("#include <begin_vertex>", `#include <begin_vertex>
                vec3 wpos = (modelMatrix * vec4(position, 1.0)).xyz;
                float sway = sin(uTime * 1.7 + wpos.x * 0.27 + wpos.z * 0.21) + 0.5 * sin(uTime * 3.1 + wpos.x * 0.6);
                transformed.x += sway * max(wpos.y - 2.4, 0.0) * 0.035;
                transformed.z += sway * max(wpos.y - 2.4, 0.0) * 0.02;`);
    };
    return m;
});

// --- Stavební pomůcky ----------------------------------------------------------
function at(mesh, x, y, z) {
    mesh.position.set(x, y, z);
    return mesh;
}
const box = (w, h, d, color, x = 0, y = 0, z = 0) => at(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), typeof color === "number" ? mat(color) : color), x, y, z);
const cyl = (rTop, rBottom, h, seg, color, x = 0, y = 0, z = 0) => at(new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBottom, h, seg), typeof color === "number" ? mat(color) : color), x, y, z);
const cone = (r, h, seg, color, x = 0, y = 0, z = 0) => at(new THREE.Mesh(new THREE.ConeGeometry(r, h, seg), typeof color === "number" ? mat(color) : color), x, y, z);

// Trám mezi dvěma body (pro příhradové konstrukce, nohy, zábradlí).
function beam(a, b, thickness, color) {
    const d = new THREE.Vector3().subVectors(b, a);
    const m = new THREE.Mesh(new THREE.BoxGeometry(thickness, d.length(), thickness), mat(color));
    m.position.copy(a).addScaledVector(d, 0.5);
    m.quaternion.setFromUnitVectors(UP, d.normalize()); // osu Y kvádru natočí do směru trámu
    return m;
}
const v3 = (x, y, z) => new THREE.Vector3(x, y, z);

// Hranol: 2D profil vytažený do délky a vystředěný. Osa vytažení = X.
function prism(points, length, color) {
    const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
    const geo = new THREE.ExtrudeGeometry(shape, { depth: length, bevelEnabled: false });
    geo.translate(0, 0, -length / 2);
    geo.rotateY(Math.PI / 2);
    return new THREE.Mesh(geo, mat(color));
}

// Rozhází vrcholy. Posun se počítá z POLOHY vrcholu, ne z indexu, takže
// vrcholy na stejném místě (švy) se posunou stejně a síť se neroztrhne.
export function jitter(geometry, amount, seed = 1) {
    const p = geometry.attributes.position;
    const h = (x, y, z, k) => {
        const s = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719 + k * 4.581 + seed) * 43758.5453;
        return (s - Math.floor(s)) * 2 - 1;
    };
    for (let i = 0; i < p.count; i++) {
        const x = Math.round(p.getX(i) * 100) / 100;
        const y = Math.round(p.getY(i) * 100) / 100;
        const z = Math.round(p.getZ(i) * 100) / 100;
        p.setXYZ(i, x + h(x, y, z, 1) * amount, y + h(x, y, z, 2) * amount * 0.5, z + h(x, y, z, 3) * amount);
    }
    return geometry;
}

const faceRand = (i, seed = 0) => {
    const s = Math.sin(i * 91.17 + seed * 13.7) * 43758.5453;
    return s - Math.floor(s);
};
// Barva o kousek světlejší/tmavší – sousední plošky se liší, i když mají
// „stejnou“ barvu, a low-poly povrch pak nepůsobí jako jednolitá plocha.
const tone = (hex, k) => new THREE.Color(hex).multiplyScalar(k);

// Obarví geometrii PO PLOŠKÁCH: pick(střed, normála, index) → barva trojúhelníku.
// Každý trojúhelník dostane vlastní tři vrcholy, takže hranice barev jsou ostré.
export function facet(geometry, pick) {
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    const p = g.attributes.position;
    const colors = new Float32Array(p.count * 3);
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    const center = new THREE.Vector3(), normal = new THREE.Vector3();
    const color = new THREE.Color();
    for (let i = 0; i < p.count; i += 3) {
        a.fromBufferAttribute(p, i);
        b.fromBufferAttribute(p, i + 1);
        c.fromBufferAttribute(p, i + 2);
        center.copy(a).add(b).add(c).divideScalar(3);
        normal.subVectors(b, a).cross(c.sub(a)).normalize();
        color.set(pick(center, normal, i / 3));
        for (let k = 0; k < 3; k++) colors.set([color.r, color.g, color.b], (i + k) * 3);
    }
    g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    g.computeVertexNormals();
    return g;
}
export const baked = (geometry) => new THREE.Mesh(geometry, BAKED);

// Upeče skupinu: statické díly → jedna síť s barvou ve vrcholech (+ jedna síť
// na každý sdílený „merge“ materiál). Díly s userData.noBake (animované) a
// s vlastním materiálem (průhledné, shadery) zůstanou, jak jsou.
// Skupina musí být v okamžiku pečení v počátku a bez rodiče.
export function bake(group) {
    group.updateMatrixWorld(true);
    const colored = [];
    const byMaterial = new Map();
    const done = [];
    const color = new THREE.Color();

    group.traverse((o) => {
        if (!o.isMesh) return;
        for (let p = o; p; p = p.parent) {
            if (p.userData.noBake) return;
            if (p === group) break;
        }
        const m = o.material;
        if (!m.userData.bake && !m.userData.merge) return;

        const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
        g.applyMatrix4(o.matrixWorld); // díl do souřadnic skupiny
        g.clearGroups();
        for (const name of Object.keys(g.attributes)) {
            if (name !== "position" && name !== "color") g.deleteAttribute(name);
        }
        if (m.userData.merge) {
            g.deleteAttribute("color");
            if (!byMaterial.has(m)) byMaterial.set(m, []);
            byMaterial.get(m).push(g);
        } else {
            if (!g.attributes.color) {
                color.copy(m.color);
                const n = g.attributes.position.count;
                const arr = new Float32Array(n * 3);
                for (let i = 0; i < n; i++) arr.set([color.r, color.g, color.b], i * 3);
                g.setAttribute("color", new THREE.BufferAttribute(arr, 3));
            }
            colored.push(g);
        }
        done.push(o);
    });

    for (const o of done) o.removeFromParent();
    const add = (geos, material) => {
        const geo = mergeGeometries(geos);
        geo.computeVertexNormals();
        const mesh = new THREE.Mesh(geo, material);
        mesh.castShadow = true;
        mesh.receiveShadow = !material.emissiveIntensity || material.emissive.getHex() === 0;
        group.add(mesh);
    };
    if (colored.length) add(colored, BAKED);
    for (const [m, geos] of byMaterial) add(geos, m);
    return group;
}

// ===========================================================================
// Loď – rybářský kutr. Příď míří do lokálního +Z, počátek je na čáře ponoru.
// ===========================================================================
export function boatModel() {
    const g = new THREE.Group();
    const DECK = 0.7; // výška paluby nad čarou ponoru

    // Půdorys trupu (x, z), po směru obvodu.
    const outline = [
        [-1.05, -2.3], [1.05, -2.3], [1.3, -1.2], [1.32, 0.4], [1.0, 1.7], [0.5, 2.6],
        [0, 3.0], [-0.5, 2.6], [-1.0, 1.7], [-1.32, 0.4], [-1.3, -1.2],
    ];
    const DEPTH = 1.05;
    const shape = new THREE.Shape(outline.map(([x, z]) => new THREE.Vector2(x, z)));
    // steps: 4 → boky trupu mají po výšce 4 pásy, které jde obarvit zvlášť
    let hull = new THREE.ExtrudeGeometry(shape, { depth: DEPTH, steps: 4, bevelEnabled: false });
    hull.rotateX(Math.PI / 2); // půdorys do roviny XZ, vytažení dolů
    const p = hull.attributes.position;
    for (let i = 0; i < p.count; i++) {
        const t = Math.max(0, -p.getY(i) / DEPTH); // 0 u paluby, 1 na kýlu
        p.setX(i, p.getX(i) * (1 - 0.55 * t ** 1.4)); // boky se ke kýlu sbíhají
        p.setZ(i, p.getZ(i) * (1 - 0.14 * t) - 0.1 * t);
    }
    hull = facet(hull, (c, n) => {
        if (n.y > 0.9) return 0xb08d5b;      // paluba – dřevo
        if (c.y > -0.27) return 0x243b53;    // horní pás – tmavě modrá
        if (c.y > -0.8) return 0xf4f1ea;     // bok – bílá
        return 0xa83232;                     // pod čarou ponoru – červený nátěr
    });
    g.add(at(baked(hull), 0, DECK, 0));

    // Zábradlí paluby (štítnice): kvádr podél každé hrany půdorysu, k přídi vyšší.
    for (let i = 0; i < outline.length; i++) {
        const [ax, az] = outline[i];
        const [bx, bz] = outline[(i + 1) % outline.length];
        const len = Math.hypot(bx - ax, bz - az);
        const h = 0.26 + Math.max(0, (az + bz) / 2) * 0.09;
        const rail = box(0.09, h, len + 0.06, 0xf4f1ea, (ax + bx) / 2, DECK + h / 2, (az + bz) / 2);
        rail.rotation.y = Math.atan2(bx - ax, bz - az);
        g.add(rail);
        const cap = box(0.15, 0.05, len + 0.08, 0x243b53, (ax + bx) / 2, DECK + h + 0.02, (az + bz) / 2);
        cap.rotation.y = rail.rotation.y;
        g.add(cap);
    }

    // Kormidelna
    const CAB_Z = -0.35;
    g.add(box(1.55, 1.2, 1.5, 0xc0392b, 0, DECK + 0.6, CAB_Z));
    g.add(box(1.59, 0.14, 1.54, 0xf4f1ea, 0, DECK + 0.07, CAB_Z));   // sokl
    g.add(box(1.9, 0.1, 2.0, 0xf4f1ea, 0, DECK + 1.25, CAB_Z + 0.1)); // střecha s přesahem
    g.add(box(1.25, 0.45, 0.06, GLASS, 0, DECK + 0.85, CAB_Z + 0.76)); // čelní okno
    for (const s of [-1, 1]) {
        g.add(box(0.06, 0.42, 0.95, GLASS, s * 0.78, DECK + 0.85, CAB_Z + 0.1));
        g.add(box(0.07, 0.5, 0.07, 0xf4f1ea, s * 0.74, DECK + 0.85, CAB_Z + 0.74)); // sloupky oken
    }
    g.add(box(0.55, 0.95, 0.06, 0x243b53, 0.2, DECK + 0.5, CAB_Z - 0.76)); // dveře na zádi

    // Poziční světla (levobok červené, pravobok zelené) a světlomet
    g.add(box(0.1, 0.1, 0.16, mat(0xff4d4d, { emissive: 0xff2020, emissiveIntensity: 3 }), 0.9, DECK + 1.36, CAB_Z + 0.5));
    g.add(box(0.1, 0.1, 0.16, mat(0x4dff7a, { emissive: 0x20ff50, emissiveIntensity: 3 }), -0.9, DECK + 1.36, CAB_Z + 0.5));
    g.add(cyl(0.11, 0.14, 0.16, 8, LAMP, 0, DECK + 1.4, CAB_Z + 0.95));

    // Radar: jediný pohyblivý díl, proto se nepeče
    g.add(cyl(0.05, 0.07, 0.3, 6, 0x4a4a4a, 0, DECK + 1.45, CAB_Z + 0.3));
    const radar = box(0.95, 0.09, 0.16, 0xf4f1ea, 0, DECK + 1.64, CAB_Z + 0.3);
    radar.userData.noBake = true;
    radar.castShadow = true;
    g.add(radar);

    // Stěžeň s ráhnem a vlajkou
    g.add(cyl(0.04, 0.06, 1.9, 6, 0x4a4a4a, 0, DECK + 2.2, CAB_Z - 0.55));
    g.add(box(0.9, 0.04, 0.04, 0x4a4a4a, 0, DECK + 2.7, CAB_Z - 0.55));
    g.add(box(0.04, 0.38, 0.62, 0x6d28d9, 0, DECK + 2.95, CAB_Z - 0.9));

    // Záchranný kruh na boku kormidelny
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.075, 6, 12), mat(0xf07a2a));
    ring.rotation.y = Math.PI / 2;
    g.add(at(ring, 0.82, DECK + 0.45, CAB_Z - 0.3));

    // Záďová paluba: bedny na ryby, stočené lano, motor
    g.add(box(0.55, 0.32, 0.4, 0x2a7de1, -0.55, DECK + 0.16, -1.75));
    g.add(box(0.55, 0.32, 0.4, 0xd9a441, -0.5, DECK + 0.48, -1.72));
    const rope = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.07, 5, 10), mat(0xcdb98a));
    rope.rotation.x = Math.PI / 2;
    g.add(at(rope, 0.6, DECK + 0.08, -1.7));
    g.add(box(0.5, 0.5, 0.42, 0x2d2d2d, 0, DECK + 0.1, -2.5));
    g.add(box(0.14, 0.9, 0.14, 0x4a4a4a, 0, -0.1, -2.55));

    // Příď: poklop, vyvazovací pacholata
    g.add(box(0.6, 0.1, 0.6, 0x8a6a42, 0, DECK + 0.05, 1.35));
    for (const s of [-1, 1]) g.add(cyl(0.06, 0.06, 0.2, 6, 0x4a4a4a, s * 0.35, DECK + 0.1, 2.15));

    // Fendry po bocích
    for (const s of [-1, 1]) {
        for (const z of [-0.9, 0.7]) g.add(cyl(0.13, 0.13, 0.5, 7, 0xf07a2a, s * 1.44, DECK - 0.15, z));
    }

    bake(g);
    g.userData.radar = radar;
    return g;
}

// ===========================================================================
// Vegetace a kameny
// ===========================================================================
export function pine(scale, random) {
    const g = new THREE.Group();
    g.add(cyl(0.16, 0.26, 1.3, 6, 0x6b4a2f, 0, 0.65, 0));
    const needles = NEEDLES[Math.floor(random() * NEEDLES.length)];
    // čtyři patra jehličí, každé menší, pootočené a lehce vyosené
    const tiers = [[1.45, 1.9, 1.7], [1.15, 1.7, 2.6], [0.85, 1.5, 3.45], [0.5, 1.3, 4.3]];
    for (const [r, h, y] of tiers) {
        const tier = cone(r, h, 7, needles, (random() - 0.5) * 0.12, y, (random() - 0.5) * 0.12);
        tier.rotation.y = random() * Math.PI;
        g.add(tier);
    }
    g.scale.set(scale, scale * (0.9 + random() * 0.35), scale);
    return g;
}

export function bush(random) {
    const r = 0.45 + random() * 0.4;
    const geo = jitter(new THREE.IcosahedronGeometry(r, 0), r * 0.22, random() * 50);
    const m = baked(facet(geo, (c, n, i) => tone(0x4e8a52, 0.85 + faceRand(i, r) * 0.35)));
    m.scale.y = 0.75;
    m.position.y = r * 0.45;
    return m;
}

export function rock(r, seed) {
    const geo = jitter(new THREE.DodecahedronGeometry(r, 0), r * 0.26, seed);
    // plošky mířící nahoru zarůstají mechem, ostatní jsou šedé s náhodným odstínem
    const m = baked(facet(geo, (c, n, i) =>
        n.y > 0.55 && c.y > r * 0.2 ? tone(0x6f8f5a, 0.9 + faceRand(i, seed) * 0.2) : tone(0x7d848c, 0.75 + faceRand(i, seed) * 0.45)));
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
}

// ===========================================================================
// Terén
// ===========================================================================
// Ostrov jako polární mřížka: soustředné prstence s daným profilem výšky.
// Střed je rovná plošina pro stavbu, pak travnatý svah, pláž a dno.
//   f = poloměr prstence jako násobek r, y = jeho výška
const ISLAND_RINGS = [
    [0.30, 1.62], [0.56, 1.5], [0.74, 1.2], [0.88, 0.5], [1.0, -0.05], [1.16, -2.7],
];
export const ISLAND_TOP = 1.5;

export function islandMesh(r, seed) {
    const SEG = 20;
    const noise = (k, s) => {
        const v = Math.sin(k * 12.9898 + s * 78.233 + seed) * 43758.5453;
        return (v - Math.floor(v)) * 2 - 1;
    };
    // Pobřeží: poloměr se s úhlem mění (±8 %), stejně pro všechny vnější prstence,
    // takže se prstence nekříží.
    const coast = Array.from({ length: SEG }, (_, i) => 1 + 0.08 * noise(i, 1));
    const ring = (ri) => {
        const [f, y] = ISLAND_RINGS[ri];
        return Array.from({ length: SEG }, (_, i) => {
            const a = (i / SEG) * Math.PI * 2;
            const rad = r * f * (ri >= 2 ? coast[i] : 1) + (ri >= 1 ? noise(i, ri + 5) * 0.35 : 0);
            return v3(Math.cos(a) * rad, y + (ri >= 1 && ri <= 3 ? noise(i, ri + 11) * 0.12 : 0), Math.sin(a) * rad);
        });
    };
    const rings = ISLAND_RINGS.map((_, ri) => ring(ri));
    const center = v3(0, ISLAND_RINGS[0][1] + 0.05, 0);

    const verts = [];
    const tri = (a, b, c) => verts.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    for (let i = 0; i < SEG; i++) {
        const j = (i + 1) % SEG;
        tri(center, rings[0][j], rings[0][i]); // pořadí vrcholů určuje, kam míří normála (nahoru)
        for (let ri = 0; ri < rings.length - 1; ri++) {
            const A = rings[ri], B = rings[ri + 1];
            tri(A[i], A[j], B[i]);
            tri(A[j], B[j], B[i]);
        }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(verts), 3));

    const mesh = baked(facet(geo, (c, n, i) => {
        const k = 0.9 + faceRand(i, seed) * 0.2;
        if (c.y < 0.1) return tone(0xb9a46e, k);   // mokrý písek a dno
        if (c.y < 0.75) return tone(0xdcc993, k);  // pláž
        if (c.y < 1.3) return tone(0x86b35f, k);   // okraj trávy
        return tone(faceRand(i, seed + 3) > 0.5 ? 0x6fa35e : 0x79ad63, k);
    }));
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    return mesh;
}

export function mountainMesh(r, h, seed) {
    const geo = new THREE.ConeGeometry(r, h, 11, 7);
    geo.translate(0, h / 2 - 3, 0); // pata 3 pod hladinou
    jitter(geo, r * 0.16, seed);
    return baked(facet(geo, (c, n, i) => {
        const k = 0.8 + faceRand(i, seed) * 0.4;
        const snowLine = h * (0.46 + faceRand(i, seed + 9) * 0.1);
        if (c.y > snowLine && n.y > 0.12) return tone(0xf2f5f7, 0.92 + faceRand(i, seed) * 0.08); // sníh drží jen na mírnějších ploškách
        if (c.y > h * 0.2) return tone(0x6c7783, k);  // skála
        if (c.y > h * 0.07) return tone(0x55725a, k); // les a mech
        return tone(0x4a6350, k);
    }));
}

// ===========================================================================
// Stavby
// ===========================================================================
// Rybářská chata (rorbu). Čelo s okny míří do +Z. Počátek = střed půdorysu na zemi.
export function cabin(color, w = 4, d = 3.2, h = 2.4, { roof = 0x3a3f47, chimney = true, door = true } = {}) {
    const g = new THREE.Group();
    const BASE = 0.3;
    g.add(box(w + 0.25, BASE, d + 0.25, 0x8b8f8a, 0, BASE / 2, 0)); // kamenná podezdívka
    g.add(box(w, h, d, color, 0, BASE + h / 2, 0));
    for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) g.add(box(0.16, h, 0.16, 0xf4f1ea, sx * w / 2, BASE + h / 2, sz * d / 2)); // rohové lišty
    }
    // sedlová střecha s přesahem + bílá štítová prkna
    const rise = d * 0.44;
    const half = d / 2 + 0.35;
    g.add(at(prism([[-half, 0], [half, 0], [0, rise]], w + 0.6, roof), 0, BASE + h, 0));
    g.add(at(prism([[-half + 0.3, 0], [half - 0.3, 0], [0, rise - 0.25]], w + 0.04, color), 0, BASE + h, 0));
    if (chimney) g.add(box(0.45, 1.1, 0.45, 0x7a4b3a, w * 0.27, BASE + h + rise * 0.75, -d * 0.12));

    const windowAt = (x, y, z, rotY = 0) => {
        const wg = new THREE.Group();
        wg.add(box(0.95, 0.95, 0.06, 0xf4f1ea, 0, 0, 0));      // rám
        wg.add(box(0.74, 0.74, 0.08, WINDOW, 0, 0, 0.02));      // svítící sklo
        wg.add(box(0.06, 0.74, 0.06, 0xf4f1ea, 0, 0, 0.06));    // příčky
        wg.add(box(0.74, 0.06, 0.06, 0xf4f1ea, 0, 0, 0.06));
        wg.add(box(1.05, 0.08, 0.16, 0xf4f1ea, 0, -0.5, 0.05)); // parapet
        wg.position.set(x, y, z);
        wg.rotation.y = rotY;
        g.add(wg);
    };
    const wy = BASE + h * 0.58;
    if (door) {
        windowAt(-w * 0.3, wy, d / 2 + 0.03);
        windowAt(w * 0.3, wy, d / 2 + 0.03);
        g.add(box(0.95, 1.65, 0.06, 0xf4f1ea, 0, BASE + 0.82, d / 2 + 0.03));
        g.add(box(0.75, 1.5, 0.08, 0x243b53, 0, BASE + 0.78, d / 2 + 0.05));
        g.add(box(1.2, 0.16, 0.5, 0x8b8f8a, 0, 0.08, d / 2 + 0.3)); // schod
        g.add(box(0.14, 0.14, 0.14, LAMP, 0, BASE + 1.85, d / 2 + 0.12)); // lampa nad dveřmi
    } else {
        windowAt(0, wy, d / 2 + 0.03);
    }
    windowAt(w / 2 + 0.03, wy, 0, Math.PI / 2);
    return g;
}

export function lighthouse() {
    const g = new THREE.Group();
    g.add(cyl(2.3, 2.8, 0.9, 10, 0x8b8f8a, 0, 0.45, 0)); // kamenný sokl
    // věž ze čtyř zužujících se dílů, střídavě bílá a červená
    for (let i = 0; i < 4; i++) {
        const rb = 1.75 - 0.175 * i;
        g.add(cyl(rb - 0.175, rb, 2, 10, i % 2 ? 0xc0392b : 0xf4f1ea, 0, 1.9 + 2 * i, 0));
    }
    g.add(box(0.8, 1.4, 0.3, 0x243b53, 0, 1.6, 1.68));
    g.add(box(1.0, 0.14, 0.4, 0x8b8f8a, 0, 2.36, 1.68));
    for (const [a, y] of [[0.9, 4.3], [-0.8, 6.2], [0.3, 7.9]]) {
        const r = 1.75 - 0.0875 * (y - 0.9) + 0.02;
        const win = box(0.4, 0.6, 0.12, GLASS, Math.sin(a) * r, y, Math.cos(a) * r);
        win.rotation.y = a;
        g.add(win);
    }
    // ochoz se zábradlím
    const DECK = 9.0;
    g.add(cyl(1.75, 1.45, 0.24, 10, 0x3a3f47, 0, DECK, 0));
    const rail = new THREE.Mesh(new THREE.TorusGeometry(1.66, 0.04, 4, 20), mat(0x3a3f47));
    rail.rotation.x = Math.PI / 2;
    g.add(at(rail, 0, DECK + 0.62, 0));
    for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        g.add(cyl(0.03, 0.03, 0.6, 4, 0x3a3f47, Math.cos(a) * 1.66, DECK + 0.4, Math.sin(a) * 1.66));
    }
    // lucerna: svítící válec v rámu, kuželová střecha, hrot
    const lamp = cyl(0.78, 0.78, 1.25, 8, mat(0xfff3c4, { emissive: 0xffc766, emissiveIntensity: 5 }), 0, DECK + 0.75, 0);
    g.add(lamp);
    for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
        g.add(box(0.07, 1.3, 0.07, 0x3a3f47, Math.cos(a) * 0.82, DECK + 0.75, Math.sin(a) * 0.82));
    }
    g.add(cyl(0.95, 0.95, 0.1, 8, 0x3a3f47, 0, DECK + 1.42, 0));
    g.add(cone(1.12, 0.95, 8, 0xc0392b, 0, DECK + 1.95, 0));
    g.add(cyl(0.02, 0.02, 0.8, 4, 0x3a3f47, 0, DECK + 2.7, 0));

    // domek strážce
    const keeper = cabin(0xf4f1ea, 3, 2.6, 1.9, { roof: 0xc0392b });
    keeper.position.set(3.7, 0, -0.4);
    keeper.rotation.y = -0.25;
    g.add(keeper);

    g.userData.lamp = lamp;
    g.userData.lampHeight = DECK + 0.75;
    return g;
}

export function smartHome() {
    const g = new THREE.Group();
    const W = 5.2, D = 3.6, H = 2.5;
    g.add(cabin(0xb5352b, W, D, H));
    const annex = cabin(0xd9a441, 3, 2.6, 2, { chimney: false, door: false });
    annex.position.set(-4.9, 0, 0.5);
    annex.rotation.y = 0.35;
    g.add(annex);

    // solární panely na jižní (čelní) střeše: nakloněné podle sklonu střechy
    const rise = D * 0.44, half = D / 2 + 0.35;
    const slope = Math.atan2(rise, half);
    for (const x of [-1.45, 0.25]) {
        const panel = box(1.5, 0.07, 1.25, 0x1f3a6b, x, 0.3 + H + rise / 2 + 0.1, half / 2);
        panel.rotation.x = slope;
        g.add(panel);
        const frame = box(1.58, 0.04, 1.33, 0xd9dde2, x, 0.3 + H + rise / 2 + 0.06, half / 2);
        frame.rotation.x = slope;
        g.add(frame);
    }
    // satelit, meteostanice, zahradní lampy – „chytrá“ domácnost
    g.add(cyl(0.04, 0.04, 0.9, 5, 0x4a4a4a, W / 2 - 0.3, 0.3 + H + 0.45, -D / 2 + 0.3));
    const dish = cone(0.42, 0.18, 10, 0xf4f1ea, W / 2 - 0.3, 0.3 + H + 0.95, -D / 2 + 0.42);
    dish.rotation.x = -1.1;
    g.add(dish);
    for (const [x, z] of [[-1.6, 3.4], [1.6, 3.4], [0, 5.0]]) {
        g.add(cyl(0.05, 0.07, 0.9, 5, 0x3a3f47, x, 0.45, z));
        g.add(box(0.2, 0.2, 0.2, LAMP, x, 0.98, z));
    }
    // hranice dřeva u přístavku
    for (let i = 0; i < 5; i++) {
        const log = cyl(0.14, 0.14, 0.9, 6, 0x8a6a42, 3.6, 0.16 + Math.floor(i / 3) * 0.26, -0.6 + (i % 3) * 0.3 + Math.floor(i / 3) * 0.15);
        log.rotation.z = Math.PI / 2;
        g.add(log);
    }
    return g;
}

export function school() {
    const g = new THREE.Group();
    const W = 8, D = 4.2, H = 3.2, BASE = 0.4;
    const WALL = 0xe8dcc4, STONE = 0x8b8f8a, SLATE = 0x3a3f47;
    g.add(box(W + 0.3, BASE, D + 0.3, STONE, 0, BASE / 2, 0));
    g.add(box(W, H, D, WALL, 0, BASE + H / 2, 0));
    g.add(box(W + 0.2, 0.18, D + 0.2, 0xf4f1ea, 0, BASE + H - 0.09, 0)); // římsa
    // valbová střecha zjednodušená na sedlovou
    g.add(at(prism([[-D / 2 - 0.3, 0], [D / 2 + 0.3, 0], [0, 1.35]], W + 0.5, SLATE), 0, BASE + H, 0));

    // vysoká okna po stranách vchodu
    for (const x of [-3.2, -2.15, 2.15, 3.2]) {
        g.add(box(0.8, 1.7, 0.06, 0xf4f1ea, x, BASE + 1.75, D / 2 + 0.03));
        g.add(box(0.6, 1.5, 0.08, WINDOW, x, BASE + 1.75, D / 2 + 0.05));
        g.add(box(0.6, 0.06, 0.06, 0xf4f1ea, x, BASE + 1.95, D / 2 + 0.1));
    }
    // portikus: schody, čtyři sloupy, kladí, trojúhelníkový štít
    g.add(box(4.2, 0.2, 1.9, STONE, 0, 0.1, D / 2 + 1.0));
    g.add(box(3.6, 0.2, 1.4, STONE, 0, 0.3, D / 2 + 0.85));
    for (const x of [-1.35, -0.45, 0.45, 1.35]) {
        g.add(cyl(0.17, 0.2, 2.6, 8, 0xf4f1ea, x, BASE + 1.3, D / 2 + 1.15));
        g.add(box(0.5, 0.12, 0.5, 0xf4f1ea, x, BASE + 2.66, D / 2 + 1.15));
    }
    g.add(box(3.5, 0.28, 1.5, 0xf4f1ea, 0, BASE + 2.86, D / 2 + 0.7));
    const pediment = prism([[-1.75, 0], [1.75, 0], [0, 0.85]], 1.5, 0xf4f1ea);
    pediment.rotation.y = Math.PI / 2; // štít čelem dopředu
    g.add(at(pediment, 0, BASE + 3.0, D / 2 + 0.7));
    g.add(box(1.1, 2.0, 0.08, 0x5a3d2b, 0, BASE + 1.0, D / 2 + 0.05)); // dveře

    // hodinová věž
    const TOWER_TOP = BASE + H + 3.4;
    g.add(box(1.9, 3.6, 1.9, WALL, 0, TOWER_TOP - 1.8, -0.5));
    g.add(box(2.1, 0.16, 2.1, 0xf4f1ea, 0, TOWER_TOP, -0.5));
    const face = cyl(0.62, 0.62, 0.08, 16, 0xf4f1ea, 0, TOWER_TOP - 0.9, 0.47);
    face.rotation.x = Math.PI / 2;
    g.add(face);
    const hourHand = box(0.07, 0.36, 0.04, SLATE, 0.08, TOWER_TOP - 0.78, 0.53);
    hourHand.rotation.z = -0.6;
    g.add(hourHand);
    g.add(box(0.05, 0.5, 0.04, SLATE, 0, TOWER_TOP - 0.68, 0.53));
    const spire = cone(1.55, 2.0, 4, 0x6d28d9, 0, TOWER_TOP + 1.08, -0.5);
    spire.rotation.y = Math.PI / 4;
    g.add(spire);

    // stožár s vlajkou
    g.add(cyl(0.05, 0.07, 5.2, 6, 0xf4f1ea, 5.0, 2.6, 2.4));
    g.add(box(1.1, 0.7, 0.04, 0x6d28d9, 5.6, 4.7, 2.4));
    return g;
}

// Popisek na bok kontejneru: text do 2D canvasu → textura na rovině.
function textPlane(text, width, height) {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = Math.round((512 * height) / width);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    let size = canvas.height * 0.62;
    do {
        ctx.font = `700 ${size}px "Inter", system-ui, sans-serif`;
        size -= 4;
    } while (ctx.measureText(text).width > canvas.width * 0.88);
    ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 4);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    return new THREE.Mesh(
        new THREE.PlaneGeometry(width, height),
        new THREE.MeshLambertMaterial({ map: texture, transparent: true, depthWrite: false })
    );
}

function container(color, label) {
    const g = new THREE.Group();
    const L = 3.2, H = 1.45, D = 1.5;
    g.add(box(L, H, D, color, 0, H / 2, 0));
    const dark = tone(color, 0.72).getHex();
    // vlnitý plech: svislá žebra na dlouhých stranách
    for (let i = 0; i < 12; i++) {
        const x = -L / 2 + 0.22 + i * ((L - 0.44) / 11);
        for (const s of [-1, 1]) g.add(box(0.1, H - 0.2, 0.05, dark, x, H / 2, s * (D / 2 + 0.02)));
    }
    // rohové sloupky a rám
    for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) g.add(box(0.12, H + 0.04, 0.12, 0x2d2d2d, sx * L / 2, H / 2, sz * D / 2));
    }
    // vrata se zavíracími tyčemi
    for (const z of [-0.36, -0.12, 0.12, 0.36]) g.add(box(0.05, H - 0.2, 0.05, 0xd9dde2, L / 2 + 0.03, H / 2, z));
    g.add(box(0.04, H - 0.1, 0.04, 0x2d2d2d, L / 2 + 0.02, H / 2, 0));
    if (label) g.add(at(textPlane(label, 2.5, 0.62), 0, H / 2, D / 2 + 0.06));
    return g;
}

// Překladiště: kontejnery nesou názvy technologií ze sekce Skills.
export function containers() {
    const g = new THREE.Group();
    const stack = [
        [-1.6, 0, -1.2, 0.04, 0x6d28d9, "Kotlin"], [1.9, 0, -0.9, -0.05, 0x2a7de1, "Docker"],
        [-1.1, 0, 1.2, 0.1, 0x2f6b4f, "PostgreSQL"], [0.1, 1.45, -1.05, 0.02, 0xd9a441, "Python"],
        [-0.9, 1.45, 1.15, 0.14, 0xc0392b, "Kafka"],
    ];
    for (const [x, y, z, rot, color, label] of stack) {
        const c = container(color, label);
        c.position.set(x, y, z);
        c.rotation.y = rot;
        g.add(c);
    }
    // jeřáb s kontejnerem na háku
    const Y = 0xe0b030;
    g.add(box(1.4, 0.4, 1.4, 0x3a3f47, 4.6, 0.2, -1.6));
    g.add(box(0.5, 7.6, 0.5, Y, 4.6, 4.2, -1.6));
    g.add(box(1.0, 0.9, 1.0, 0xf4f1ea, 4.6, 7.2, -1.6));       // kabina
    g.add(box(0.7, 0.4, 0.06, GLASS, 4.6, 7.3, -1.08));
    g.add(box(7.4, 0.36, 0.36, Y, 2.0, 8.0, -1.6));            // výložník
    g.add(box(1.2, 0.8, 0.8, 0x3a3f47, 6.0, 7.7, -1.6));       // protizávaží
    g.add(beam(v3(4.6, 9.4, -1.6), v3(-1.5, 8.2, -1.6), 0.06, 0x2d2d2d));
    g.add(beam(v3(4.6, 9.4, -1.6), v3(6.4, 8.1, -1.6), 0.06, 0x2d2d2d));
    g.add(box(0.36, 1.5, 0.36, Y, 4.6, 8.7, -1.6));
    g.add(cyl(0.025, 0.025, 2.9, 4, 0x2d2d2d, 0.6, 6.4, -1.6)); // lano
    const hanging = container(0x2a9d8f, "TypeScript");
    hanging.position.set(0.6, 3.5, -1.6);
    hanging.rotation.y = 0.2;
    g.add(hanging);
    return g;
}

export function radioMast() {
    const g = new THREE.Group();
    // příhradový stožár: 4 nohy sbíhající se k vrcholu, po patrech vodorovné
    // rámy a úhlopříčky, patra střídavě červená a bílá
    const LEVELS = 5, HEIGHT = 11, BASE = 1.15, TOP = 0.18;
    const corner = (level, sx, sz) => {
        const t = level / LEVELS;
        const half = BASE + (TOP - BASE) * t;
        return v3(sx * half, HEIGHT * t, sz * half);
    };
    const corners = [[1, 1], [1, -1], [-1, -1], [-1, 1]];
    for (let l = 0; l < LEVELS; l++) {
        const color = l % 2 ? 0xf4f1ea : 0xc0392b;
        corners.forEach(([sx, sz], i) => {
            const [nx, nz] = corners[(i + 1) % 4];
            g.add(beam(corner(l, sx, sz), corner(l + 1, sx, sz), 0.1, color));    // noha
            g.add(beam(corner(l + 1, sx, sz), corner(l + 1, nx, nz), 0.06, color)); // rám
            g.add(beam(corner(l, sx, sz), corner(l + 1, nx, nz), 0.05, color));     // úhlopříčka
        });
    }
    g.add(cyl(0.04, 0.04, 1.6, 5, 0x4a4a4a, 0, HEIGHT + 0.8, 0));
    const light = at(new THREE.Mesh(new THREE.SphereGeometry(0.24, 6, 5), mat(0xff5a5a, { emissive: 0xff2d2d, emissiveIntensity: 6 })), 0, HEIGHT + 1.7, 0);
    g.add(light);
    for (const [y, a] of [[7.2, 0.6], [8.4, -1.2]]) {
        const drum = cyl(0.42, 0.42, 0.22, 10, 0xf4f1ea, Math.sin(a) * 0.6, y, Math.cos(a) * 0.6);
        drum.rotation.x = Math.PI / 2;
        drum.rotation.z = -a;
        g.add(drum);
    }
    for (const [sx, sz] of corners) g.add(box(0.5, 0.25, 0.5, 0x8b8f8a, sx * BASE, 0.1, sz * BASE)); // patky

    const hut = cabin(0x2a6fb0, 2.8, 2.4, 1.9, { chimney: false });
    hut.position.set(3.6, 0, 0.6);
    hut.rotation.y = -0.3;
    g.add(hut);

    // poštovní schránka – jsme na ostrově Kontakt
    g.add(cyl(0.06, 0.06, 1.0, 5, 0x6b4a2f, -2.6, 0.5, 2.6));
    g.add(box(0.6, 0.4, 0.4, 0xc0392b, -2.6, 1.15, 2.6));
    g.add(box(0.04, 0.3, 0.2, 0xf4f1ea, -2.28, 1.3, 2.6));

    g.userData.light = light;
    return g;
}

// Ostrov Projekty (Aurora Tonight): malá observatoř s kupolí, dalekohled
// ve štěrbině a fotoaparát na stativu namířený k severu.
export function observatory() {
    const g = new THREE.Group();
    const WALL = 0xf4f1ea, STONE = 0x8b8f8a, DARK = 0x3a3f47;
    g.add(cyl(2.7, 3.0, 0.6, 12, STONE, 0, 0.3, 0)); // sokl
    g.add(cyl(2.3, 2.3, 2.6, 12, WALL, 0, 1.9, 0));  // válcová stěna
    g.add(cyl(2.45, 2.45, 0.18, 12, DARK, 0, 3.25, 0)); // věnec pod kupolí
    // kupole = polokoule; štěrbina je tmavý pás přes vrchol, natočený k severu (−Z)
    const dome = new THREE.Mesh(new THREE.SphereGeometry(2.35, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat(0xd9dde2));
    g.add(at(dome, 0, 3.34, 0));
    const slit = new THREE.Mesh(new THREE.SphereGeometry(2.4, 14, 8, -0.22 - Math.PI / 2, 0.44, 0.05, Math.PI / 2 - 0.05), mat(0x1c2430));
    g.add(at(slit, 0, 3.34, 0));
    // dalekohled vykukuje ze štěrbiny pod úhlem k obloze
    const tube = cyl(0.32, 0.38, 3.2, 10, 0xe8e8ec, 0, 4.9, -1.2);
    tube.rotation.x = -0.75;
    g.add(tube);
    g.add(cyl(0.36, 0.36, 0.2, 10, DARK, 0, 5.95, -2.25).rotateX(-0.75));
    // dveře a okno do zálivu (+Z = k molu po natočení ostrova se neřeší, je to jen detail)
    g.add(box(0.8, 1.5, 0.12, 0x243b53, 0, 1.35, 2.28));
    g.add(box(1.2, 0.16, 0.5, STONE, 0, 0.68, 2.5));
    // stativ s fotoaparátem na kraji plošiny
    const TX = 3.4, TZ = -2.4;
    for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        g.add(beam(v3(TX + Math.cos(a) * 0.45, 0, TZ + Math.sin(a) * 0.45), v3(TX, 1.25, TZ), 0.06, DARK));
    }
    const camera = box(0.45, 0.32, 0.3, 0x1f1f24, TX, 1.42, TZ);
    camera.rotation.x = 0.35;
    g.add(camera);
    g.add(cyl(0.11, 0.11, 0.3, 8, 0x1f1f24, TX, 1.52, TZ - 0.25).rotateX(Math.PI / 2 + 0.35));
    // lavička vedle (čekání na záři)
    g.add(box(1.6, 0.12, 0.45, 0x8a6a42, -3.4, 0.55, -1.6));
    for (const dx of [-0.65, 0.65]) g.add(box(0.1, 0.5, 0.4, 0x6b4a2f, -3.4 + dx, 0.25, -1.6));
    return g;
}

// Molo: vybíhá z počátku podél +X, paluba 0,95 nad hladinou.
export function dock(length) {
    const g = new THREE.Group();
    const Y = 0.95, WIDTH = 2.1;
    const planks = Math.floor(length / 0.5);
    for (let i = 0; i < planks; i++) {
        const shade = i % 3 === 0 ? 0x8f6d4a : i % 3 === 1 ? 0x9b7653 : 0xa5805c;
        g.add(box(0.44, 0.1, WIDTH + (i % 2) * 0.08, shade, 0.25 + i * 0.5, Y, 0));
    }
    for (const s of [-1, 1]) g.add(box(length, 0.16, 0.14, 0x6b4a2f, length / 2, Y - 0.13, s * 0.8)); // podélníky
    for (const along of [0.12, 0.55, 0.97]) {
        for (const s of [-1, 1]) {
            const tall = along > 0.9;
            g.add(cyl(0.15, 0.17, tall ? 3.6 : 3.0, 6, 0x5a3d2b, length * along, tall ? -0.2 : -0.6, s * 1.02));
            if (tall) g.add(cyl(0.19, 0.19, 0.08, 6, 0xcdb98a, length * along, 1.42, s * 1.02)); // lano kolem pacholete
        }
    }
    // žebřík do vody a lampa na konci
    for (const s of [-1, 1]) g.add(box(0.06, 1.7, 0.06, 0x4a4a4a, length + 0.08, 0.3, 0.45 + s * 0.2));
    for (const y of [-0.3, 0.1, 0.5, 0.9]) g.add(box(0.06, 0.05, 0.46, 0x4a4a4a, length + 0.08, y, 0.45));
    g.add(cyl(0.05, 0.06, 2.1, 5, 0x3a3f47, length * 0.97, Y + 1.05, -1.02));
    g.add(box(0.26, 0.26, 0.26, LAMP, length * 0.97, Y + 2.15, -1.02));
    g.add(cone(0.3, 0.18, 4, 0x3a3f47, length * 0.97, Y + 2.38, -1.02));
    return bake(g);
}

// ===========================================================================
// Bóje
// ===========================================================================
export function buoyModel(color) {
    const g = new THREE.Group();
    g.add(cyl(0.72, 0.85, 0.55, 9, color, 0, 0.12, 0));
    g.add(cyl(0.74, 0.74, 0.12, 9, 0xf4f1ea, 0, 0.36, 0));
    // klec ze čtyř noh, nahoře plošinka se světlem a kuželovým znakem
    for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        g.add(beam(v3(Math.cos(a) * 0.5, 0.4, Math.sin(a) * 0.5), v3(Math.cos(a) * 0.14, 1.6, Math.sin(a) * 0.14), 0.07, color));
    }
    g.add(cyl(0.22, 0.22, 0.08, 8, 0xf4f1ea, 0, 1.62, 0));
    g.add(cyl(0.11, 0.11, 0.2, 6, LAMP, 0, 1.76, 0));
    g.add(cone(0.2, 0.36, 6, color, 0, 2.05, 0));
    return bake(g);
}

// ===========================================================================
// Lysefjord: Preikestolen a Kjerag
// ===========================================================================
// Obě skály stojí čelem do lokálního +Z (do zálivu); za nimi (−Z) navazuje masiv.
const CLIFF = (seed) => (c, n, i) => {
    const k = 0.82 + faceRand(i, seed) * 0.32;
    if (n.y > 0.6) return tone(0xb9b3a4, k);                           // ohlazený vršek
    if (faceRand(i, seed + 5) > 0.82) return tone(0x5d6168, k);        // tmavé pruhy po stékající vodě
    return tone(0x8a8d90, k);
};
function cliffBlock(w, h, d, seed, x = 0, z = 0) {
    const geo = new THREE.BoxGeometry(w, h, d, 2, 5, 2);
    geo.translate(0, h / 2 - 3, 0); // pata pod hladinou
    jitter(geo, 0.55, seed);
    return at(baked(facet(geo, CLIFF(seed))), x, 0, z);
}
function hiker(color, x, y, z) {
    const g = new THREE.Group();
    g.add(box(0.26, 0.5, 0.2, color, 0, 0.45, 0));
    g.add(box(0.2, 0.2, 0.2, 0xe8c9a0, 0, 0.82, 0));
    g.add(box(0.1, 0.24, 0.12, 0x2d2d2d, -0.07, 0.12, 0), box(0.1, 0.24, 0.12, 0x2d2d2d, 0.07, 0.12, 0));
    g.position.set(x, y, z);
    return g;
}

// Preikestolen („Kazatelna“): hranatá plošina s kolmými stěnami, 604 m nad fjordem.
export function preikestolen() {
    const g = new THREE.Group();
    const H = 27;
    g.add(cliffBlock(10, H, 10, 3.1, 0, 4));        // samotná kazatelna
    g.add(cliffBlock(20, H - 3, 14, 7.7, -3, -7));  // náhorní plošina za ní
    g.add(cliffBlock(30, H - 11, 18, 5.2, 6, -16)); // masiv
    g.add(cliffBlock(7, 9, 6, 9.4, 8, 6));          // suť u paty
    const top = H - 3 + 0.25;
    g.add(hiker(0xc0392b, 2.5, top, 7), hiker(0x2a7de1, -1.5, top, 5.5), hiker(0xd9a441, -2.2, top, 6.2), hiker(0x6d28d9, 0.6, top, 2));
    for (const [x, z] of [[-9, -6], [-6, -11], [3, -9]]) g.add(at(cone(1.3, 3.6, 5, 0x2f5d45), x, H - 6 + 1.6, z));
    return bake(g);
}

// Kjerag: dvě stěny s průrvou, v ní zaklíněný balvan Kjeragbolten (984 m nad fjordem).
export function kjerag() {
    const g = new THREE.Group();
    const H = 27;
    g.add(cliffBlock(9, H, 13, 11.3, -5.9, 0));
    g.add(cliffBlock(9, H - 1.5, 13, 14.9, 5.9, 0));
    g.add(cliffBlock(30, H - 9, 16, 12.6, 0, -14));
    // balvan mezi stěnami
    const bolt = baked(facet(jitter(new THREE.DodecahedronGeometry(1.75, 0), 0.3, 4.4), (c, n, i) => tone(0x9a958a, 0.8 + faceRand(i, 2) * 0.35)));
    bolt.scale.set(1.05, 0.9, 1.2);
    g.add(at(bolt, 0, H - 8, 3.5));
    g.add(hiker(0xf07a2a, 0, H - 8 + 1.45, 3.5));
    g.add(hiker(0x2a7de1, -4.5, H - 3 + 0.2, 4), hiker(0xc0392b, 5, H - 4.5 + 0.2, 3));
    return bake(g);
}
