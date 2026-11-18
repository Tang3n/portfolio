import * as THREE from "three";

// ---------------------------------------------------------------------------
// 1) Dlouhé vlny (swell)
// ---------------------------------------------------------------------------
// Součet rovinných vln. Každá má směr, vlnovou délku λ a amplitudu; úhlová
// rychlost se NEVOLÍ, ale plyne z disperzního vztahu pro hlubokou vodu
//     ω = sqrt(g · k),  k = 2π / λ
// takže delší vlny běží rychleji než krátké – proto se vzor na hladině
// neustále „přeskupuje“ a neopakuje se jako jedna posouvající se textura.
// g je zmenšené (klidnější moře v měřítku hračkové lodi).
const G = 3.4;
const WAVES = [
    { dir: [1.0, 0.25], length: 46, amp: 0.34, phase: 0.0 },
    { dir: [0.3, 1.0], length: 27, amp: 0.2, phase: 1.7 },
    { dir: [-0.7, 0.6], length: 15, amp: 0.11, phase: 4.0 },
    { dir: [0.8, -0.5], length: 8.5, amp: 0.05, phase: 2.6 },
].map((w) => {
    const len = Math.hypot(w.dir[0], w.dir[1]);
    const k = (2 * Math.PI) / w.length;
    return { kx: (w.dir[0] / len) * k, kz: (w.dir[1] / len) * k, omega: Math.sqrt(G * k), amp: w.amp, phase: w.phase };
});

// Společný násobek amplitudy (1 = normální moře). Snižuje se pro uživatele,
// kteří mají v systému zapnuté „omezit pohyb“.
let swellScale = 1;

// CPU verze – používá ji fyzika (loď, bóje).
export function swellHeight(x, z, t) {
    let h = 0;
    for (const w of WAVES) h += w.amp * Math.sin(w.kx * x + w.kz * z - w.omega * t + w.phase);
    return h * swellScale;
}

// GPU verze téže funkce se GENERUJE ze stejné tabulky, takže se obě nemůžou
// rozejít (kdyby se rozešly, loď by plula nad nebo pod viditelnou hladinou).
const f = (n) => n.toFixed(5);
const GLSL_SWELL = `
float swell(vec2 p, float t) {
    float h = 0.0;
${WAVES.map((w) => `    h += ${f(w.amp)} * sin(${f(w.kx)} * p.x + ${f(w.kz)} * p.y - ${f(w.omega)} * t + ${f(w.phase)});`).join("\n")}
    return h;
}`;

// ---------------------------------------------------------------------------
// 2) Síť hladiny a její shader
// ---------------------------------------------------------------------------
// Vycházíme z MeshStandardMaterial (dostaneme zadarmo světla, stíny, mlhu,
// tone mapping) a přes onBeforeCompile do něj vložíme vlastní kusy GLSL:
//   vertex:   posun vrcholu o swell + výšku ze simulace (textura uField.r)
//   fragment: barva podle hloubky, pěna, průhlednost na mělčině, odlesk oblohy
// uField je textura ze simulace (ripples.js): R = výška, G = pěna, B = vzdálenost od břehu.
export function createWater(ripples, { size = 440, segments = 220, sky = 0xffffff, swell = 1 } = {}) {
    swellScale = swell;
    const geometry = new THREE.PlaneGeometry(size, size, segments, segments);
    geometry.rotateX(-Math.PI / 2);

    const uniforms = {
        uTime: { value: 0 },
        uSwell: { value: swell },
        uField: { value: ripples.texture },
        uSize: { value: ripples.size },
        uRange: { value: ripples.range },
        uShoreMax: { value: ripples.shoreMax },
        uDeep: { value: new THREE.Color(0x0a5f7d) },
        uShallow: { value: new THREE.Color(0x3fc1b0) },
        uCrest: { value: new THREE.Color(0x6fd0d6) },
        uSky: { value: new THREE.Color(sky) },
    };

    const material = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.34,
        metalness: 0,
        flatShading: true, // normála z derivací ve fragment shaderu → funguje i po posunu vrcholů na GPU
        transparent: true,
    });

    material.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, uniforms);

        shader.vertexShader = shader.vertexShader
            .replace("#include <common>", `#include <common>
                uniform float uTime;
                uniform sampler2D uField;
                uniform float uSize;
                uniform float uRange;
                uniform float uSwell;
                varying vec2 vXZ;
                varying float vHeight;
                varying float vRipple;
                ${GLSL_SWELL}`)
            .replace("#include <begin_vertex>", `#include <begin_vertex>
                vXZ = position.xz;
                // výška ze simulace je v textuře zakódovaná do 0..255 (128 = klid)
                float ripple = (texture2D(uField, vXZ / uSize + 0.5).r * 255.0 - 128.0) / 127.0 * uRange;
                vRipple = ripple;
                vHeight = swell(vXZ, uTime) * uSwell + ripple;
                transformed.y += vHeight;`);

        shader.fragmentShader = shader.fragmentShader
            .replace("#include <common>", `#include <common>
                uniform float uTime;
                uniform sampler2D uField;
                uniform float uSize;
                uniform float uShoreMax;
                uniform vec3 uDeep;
                uniform vec3 uShallow;
                uniform vec3 uCrest;
                uniform vec3 uSky;
                varying vec2 vXZ;
                varying float vHeight;
                varying float vRipple;

                // hodnotový šum: náhodná čísla v rozích čtverců, hladce proložená
                float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
                float vnoise(vec2 p) {
                    vec2 i = floor(p), f = fract(p);
                    f = f * f * (3.0 - 2.0 * f);
                    return mix(mix(hash21(i), hash21(i + vec2(1, 0)), f.x),
                               mix(hash21(i + vec2(0, 1)), hash21(i + vec2(1, 1)), f.x), f.y);
                }`)
            .replace("#include <color_fragment>", `#include <color_fragment>
                vec4 field = texture2D(uField, vXZ / uSize + 0.5);
                float shore = field.b * uShoreMax;                 // metry k nejbližší pevnině
                float shallow = 1.0 - smoothstep(0.0, 8.0, shore); // 1 u břehu → 0 na hloubce

                // barva: hluboká → tyrkysová mělčina; hřebeny vln světlejší (světlo prosvítá tenčí vodou)
                vec3 water = mix(uDeep, uShallow, shallow);
                water = mix(water, uCrest, smoothstep(0.15, 0.75, vHeight) * 0.4);

                // pěna: lem u břehu + pruhy běžící ke břehu + stopa lodi (G) + strmé vlnky ze simulace
                float n = vnoise(vXZ * 0.8 + uTime * 0.15);
                float lap = sin(shore * 1.5 - uTime * 1.2 + n * 2.0);
                float foam = (1.0 - smoothstep(0.3, 1.2, shore))
                           + smoothstep(0.5, 0.95, lap) * (1.0 - smoothstep(1.0, 6.0, shore)) * 0.8
                           + field.g * 1.4
                           + smoothstep(0.16, 0.4, abs(vRipple));
                foam = smoothstep(0.35, 0.75, foam * (0.55 + 0.9 * n)); // šum pěnu roztrhá na chuchvalce

                diffuseColor.rgb = mix(water, vec3(1.0), foam);
                diffuseColor.a = max(mix(0.95, 0.6, shallow), foam);    // na mělčině je vidět dno`)
            .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
                // Fresnel: čím plošší úhel pohledu na plošku, tím víc odráží oblohu.
                float fresnel = pow(1.0 - max(dot(normalize(vViewPosition), normal), 0.0), 4.0);
                totalEmissiveRadiance += uSky * fresnel * 0.35 * (1.0 - foam);`)
            .replace("#include <lights_fragment_end>", `#include <lights_fragment_end>
                // Nízké slunce proti kameře dává na hladké vodě obří přepálený odlesk.
                // Necháme z něj jen třpyt, aby nepřebil zbytek scény.
                reflectedLight.directSpecular *= 0.28;`);
    };

    const mesh = new THREE.Mesh(geometry, material);
    mesh.receiveShadow = true;
    mesh.renderOrder = 1;

    // Dno: voda je na mělčině průhledná, takže pod ní musí něco být. Písčitá
    // rovina pod hladinou dá mělčinám tyrkysovou barvu (písek × barva vody).
    const seabed = new THREE.Mesh(
        new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2),
        new THREE.MeshLambertMaterial({ color: 0xbfae82 })
    );
    seabed.position.y = -2.6;
    mesh.add(seabed);

    let time = 0;
    return {
        mesh,
        update(t) {
            time = t;
            uniforms.uTime.value = t;
        },
        // Výška hladiny pro fyziku = swell + simulované vlny.
        heightAt: (x, z) => swellHeight(x, z, time) + ripples.sample(x, z),
    };
}
