import * as THREE from "three";

// Simulace vln na mřížce (2D vlnová rovnice):
//     ∂²h/∂t² = c² · ∇²h
// h = výchylka hladiny v buňce, v = její svislá rychlost. Laplacián ∇²h je
// „o kolik je buňka níž než průměr sousedů“ – voda se tlačí tam, kde je
// důlek, a tím se porucha šíří rychlostí c do všech stran.
//
// Loď a nárazy do mřížky „šťouchají“ (splat), o zbytek se stará rovnice:
// vlny se rozbíhají, slábnou, odrážejí od ostrovů a houpou bójemi.

const C = 5.0;          // rychlost šíření [m/s]
const DAMPING = 0.45;   // útlum rychlosti [1/s]
const SETTLE = 0.12;    // pomalý návrat k nule (jinak by se hladina trvale „nahrbila“)
const FOAM_DECAY = 0.7; // jak rychle mizí pěna [1/s]

export function createRipples(colliders, { size = 440, n = 320, range = 0.9, shoreMax = 12 } = {}) {
    const dx = size / n;
    const h = new Float32Array(n * n);
    const v = new Float32Array(n * n);
    const foam = new Float32Array(n * n);
    const water = new Uint8Array(n * n); // 1 = voda, 0 = pevnina
    // RGBA textura pro shader: R výška, G pěna, B vzdálenost od břehu (statická).
    const pixels = new Uint8Array(n * n * 4);

    // Pevnina = buňky uvnitř kolizních kružnic (mola vynecháme, vlny jdou pod nimi).
    const land = colliders.filter((c) => c.r >= 1.3);
    for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
            const x = -size / 2 + (i + 0.5) * dx;
            const z = -size / 2 + (j + 0.5) * dx;
            let d = shoreMax;
            for (const c of land) d = Math.min(d, Math.hypot(x - c.x, z - c.z) - c.r);
            const idx = j * n + i;
            water[idx] = d > 0 ? 1 : 0;
            pixels[idx * 4] = 128; // klidná hladina; upload() pak přepisuje jen aktivní oblast
            pixels[idx * 4 + 2] = Math.round((Math.max(0, d) / shoreMax) * 255);
            pixels[idx * 4 + 3] = 255;
        }
    }

    const texture = new THREE.DataTexture(pixels, n, n, THREE.RGBAFormat, THREE.UnsignedByteType);
    texture.magFilter = THREE.LinearFilter; // bilineární čtení → hladký povrch i s hrubší mřížkou
    texture.minFilter = THREE.LinearFilter;
    texture.needsUpdate = true;

    // --- Aktivní oblast -----------------------------------------------------
    // Většina hladiny je v klidu (h = v = 0) a rovnice by tam jen násobila nuly.
    // Držíme proto obdélník buněk, kde se něco děje, a počítáme jen v něm:
    //   - splat() ho rozšíří o místo poruchy,
    //   - každý krok se nafoukne rychlostí šíření vln (aby vlna neutekla ven),
    //   - jednou za čas se smrští na buňky, které ještě nejsou v klidu.
    // Na tvém stroji to snížilo cenu kroku z ~3,3 ms na zlomek.
    const EPS = 0.002;   // pod tímhle je buňka „v klidu“ (méně než 1 stupeň v 8bit textuře)
    const MARGIN = 3;
    let i0 = n, i1 = -1, j0 = n, j1 = -1; // prázdný obdélník: i1 < i0
    let growth = 0;
    let sinceTrim = 0;
    let dirty = false; // je potřeba znovu nahrát texturu?

    const isEmpty = () => i1 < i0;
    function include(ci, cj, radius) {
        i0 = Math.max(1, Math.min(i0, ci - radius));
        i1 = Math.min(n - 2, Math.max(i1, ci + radius));
        j0 = Math.max(1, Math.min(j0, cj - radius));
        j1 = Math.min(n - 2, Math.max(j1, cj + radius));
    }

    // Smrští obdélník na neklidné buňky; co zůstane venku, vynuluje (i v textuře).
    function trim() {
        let a0 = n, a1 = -1, b0 = n, b1 = -1;
        for (let j = j0; j <= j1; j++) {
            for (let i = i0, idx = j * n + i0; i <= i1; i++, idx++) {
                if (Math.abs(h[idx]) > EPS || Math.abs(v[idx]) > EPS || foam[idx] > 0.004) {
                    if (i < a0) a0 = i;
                    if (i > a1) a1 = i;
                    if (j < b0) b0 = j;
                    if (j > b1) b1 = j;
                }
            }
        }
        if (a1 >= a0) {
            a0 = Math.max(1, a0 - MARGIN); a1 = Math.min(n - 2, a1 + MARGIN);
            b0 = Math.max(1, b0 - MARGIN); b1 = Math.min(n - 2, b1 + MARGIN);
        }
        for (let j = j0; j <= j1; j++) {
            for (let i = i0, idx = j * n + i0; i <= i1; i++, idx++) {
                if (i >= a0 && i <= a1 && j >= b0 && j <= b1) continue;
                h[idx] = v[idx] = foam[idx] = 0;
                pixels[idx * 4] = 128;
                pixels[idx * 4 + 1] = 0;
            }
        }
        i0 = a0; i1 = a1; j0 = b0; j1 = b1;
        dirty = true;
    }

    // Jeden krok simulace. Stabilní, dokud c·dt/dx < 1/√2 (tady ≈ 0,06).
    function step(dt) {
        if (isEmpty()) return;

        // nafouknutí: vlna urazí c·dt metrů za krok; 1,5× je rezerva
        growth += (1.5 * C * dt) / dx;
        if (growth >= 1) {
            growth -= 1;
            include(i0, j0, 1);
            include(i1, j1, 1);
        }

        const k = ((C * C) / (dx * dx)) * dt;
        const damp = Math.exp(-DAMPING * dt);
        const settle = Math.exp(-SETTLE * dt);
        const foamK = Math.exp(-FOAM_DECAY * dt);

        // 1) zrychlení z laplaciánu → rychlost
        for (let j = j0; j <= j1; j++) {
            for (let i = i0, idx = j * n + i0; i <= i1; i++, idx++) {
                if (!water[idx]) continue;
                v[idx] = (v[idx] + k * (h[idx - 1] + h[idx + 1] + h[idx - n] + h[idx + n] - 4 * h[idx])) * damp;
            }
        }
        // 2) rychlost → výška. Pevnina drží h = 0, což je pevný okraj: vlna se od něj odrazí.
        for (let j = j0; j <= j1; j++) {
            for (let i = i0, idx = j * n + i0; i <= i1; i++, idx++) {
                h[idx] = water[idx] ? (h[idx] + v[idx] * dt) * settle : 0;
                foam[idx] *= foamK;
            }
        }
        dirty = true;

        if (++sinceTrim >= 30) { // dvakrát za sekundu
            sinceTrim = 0;
            trim();
        }
    }

    // Lokální porucha hladiny: Gaussův „kopeček“ (nebo důlek) přes pár buněk.
    function splat(x, z, amount, foamAmount = 0) {
        const ci = Math.floor((x + size / 2) / dx);
        const cj = Math.floor((z + size / 2) / dx);
        if (ci < 3 || cj < 3 || ci >= n - 3 || cj >= n - 3) return;
        include(ci, cj, MARGIN);
        for (let dj = -2; dj <= 2; dj++) {
            for (let di = -2; di <= 2; di++) {
                const idx = (cj + dj) * n + ci + di;
                if (!water[idx]) continue;
                const w = Math.exp(-(di * di + dj * dj) / 2);
                h[idx] += amount * w;
                foam[idx] = Math.min(1, foam[idx] + foamAmount * w);
            }
        }
    }

    // Výška v libovolném bodě: bilineární interpolace mezi 4 buňkami
    // (stejně, jako texturu čte GPU, takže fyzika sedí s obrazem).
    function sample(x, z) {
        const fx = (x + size / 2) / dx - 0.5;
        const fz = (z + size / 2) / dx - 0.5;
        const i = Math.floor(fx), j = Math.floor(fz);
        if (i < 0 || j < 0 || i >= n - 1 || j >= n - 1) return 0;
        const tx = fx - i, tz = fz - j;
        const a = j * n + i;
        return (h[a] * (1 - tx) + h[a + 1] * tx) * (1 - tz) + (h[a + n] * (1 - tx) + h[a + n + 1] * tx) * tz;
    }

    // Jednou za snímek: přepiš R a G kanál textury v aktivní oblasti a pošli ji
    // na GPU. Když se nic nezměnilo, nenahrává se nic.
    function upload() {
        if (!dirty) return;
        dirty = false;
        for (let j = j0; j <= j1; j++) {
            for (let i = i0, idx = j * n + i0, p = idx * 4; i <= i1; i++, idx++, p += 4) {
                const e = Math.round((h[idx] / range) * 127 + 128);
                pixels[p] = e < 0 ? 0 : e > 255 ? 255 : e;
                pixels[p + 1] = foam[idx] * 255;
            }
        }
        texture.needsUpdate = true;
    }

    // Pro ladění: kolik buněk se právě počítá.
    const activeCells = () => (isEmpty() ? 0 : (i1 - i0 + 1) * (j1 - j0 + 1));

    return { texture, size, range, shoreMax, step, splat, sample, upload, activeCells };
}
