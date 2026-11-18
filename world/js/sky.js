import * as THREE from "three";

// Obloha: velká koule kolem kamery s vlastním shaderem. Barva se počítá ze
// SMĚRU pohledu (ne z textury): přechod obzor → zenit, sluneční kotouč se
// září a mraky ze šumu promítnutého na rovinu nad hlavou.
export function createSky({ horizon, zenith, sunColor, sunDir }) {
    const uniforms = {
        uHorizon: { value: new THREE.Color(horizon) },
        uZenith: { value: new THREE.Color(zenith) },
        uSunColor: { value: new THREE.Color(sunColor) },
        uSunDir: { value: sunDir.clone().normalize() },
        uTime: { value: 0 },
    };
    const material = new THREE.ShaderMaterial({
        uniforms,
        side: THREE.BackSide, // díváme se na kouli zevnitř
        depthWrite: false,
        fog: false,
        vertexShader: `
            varying vec3 vDir;
            void main() {
                vDir = position;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }`,
        fragmentShader: `
            uniform vec3 uHorizon, uZenith, uSunColor, uSunDir;
            uniform float uTime;
            varying vec3 vDir;

            float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
            float vnoise(vec2 p) {
                vec2 i = floor(p), f = fract(p);
                f = f * f * (3.0 - 2.0 * f);
                return mix(mix(hash21(i), hash21(i + vec2(1, 0)), f.x),
                           mix(hash21(i + vec2(0, 1)), hash21(i + vec2(1, 1)), f.x), f.y);
            }
            // fBm: několik oktáv šumu přes sebe (každá 2× jemnější a 2× slabší)
            float fbm(vec2 p) {
                float a = 0.5, s = 0.0;
                for (int i = 0; i < 4; i++) { s += a * vnoise(p); p *= 2.03; a *= 0.5; }
                return s;
            }

            void main() {
                vec3 d = normalize(vDir);
                float up = max(d.y, 0.0);
                vec3 col = mix(uHorizon, uZenith, pow(up, 0.5));

                float s = max(dot(d, uSunDir), 0.0);
                col += uSunColor * (pow(s, 900.0) * 6.0 + pow(s, 24.0) * 0.5 + pow(s, 4.0) * 0.18);

                // mraky: průsečík paprsku s rovinou ve výšce 1 → 2D souřadnice pro šum
                vec2 uv = d.xz / (d.y + 0.12) * 0.9 + uTime * 0.012;
                float cloud = smoothstep(0.5, 0.78, fbm(uv)) * smoothstep(0.02, 0.22, d.y);
                col = mix(col, mix(vec3(1.0), uSunColor, 0.35) * 1.05, cloud * 0.75);

                gl_FragColor = vec4(col, 1.0);
                #include <tonemapping_fragment>
                #include <colorspace_fragment>
            }`,
    });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(600, 32, 16), material);
    mesh.renderOrder = -1;
    mesh.frustumCulled = false;
    return { mesh, uniforms };
}
