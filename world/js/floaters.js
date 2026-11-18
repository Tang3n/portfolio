import * as THREE from "three";
import { BOAT_RADIUS } from "./boat.js";
import { buoyModel } from "./models.js";

// Bóje: dynamická tělesa, do kterých jde lodí strkat a která se houpou na vlnách.

const BUOY_RADIUS = 0.8;
const BUOY_DRAG = 1.1;
const RESTITUTION = 0.35; // pružnost odrazu (0 = plastický, 1 = dokonale pružný)

// Vytlačí kružnici (x, z, r) ze statických překážek a odrazí její rychlost.
// Používá ji loď i bóje. Vrací true, pokud došlo ke kontaktu.
export function resolveStatic(body, radius, colliders, restitution = RESTITUTION) {
    let hit = false;
    for (const c of colliders) {
        const dx = body.x - c.x;
        const dz = body.z - c.z;
        const min = c.r + radius;
        const d2 = dx * dx + dz * dz;
        if (d2 >= min * min || d2 === 0) continue;
        const d = Math.sqrt(d2);
        const nx = dx / d; // normála kontaktu: od středu překážky k tělesu
        const nz = dz / d;
        // 1) polohová korekce – vystrč těleso přesně na hranu
        body.x += nx * (min - d);
        body.z += nz * (min - d);
        // 2) rychlost – složku směřující DO překážky otoč a ztlum
        const vn = body.vx * nx + body.vz * nz;
        if (vn < 0) {
            body.vx -= (1 + restitution) * vn * nx;
            body.vz -= (1 + restitution) * vn * nz;
        }
        hit = true;
    }
    return hit;
}

export function createBuoys(colliders) {
    const group = new THREE.Group();
    const spots = [
        [6, -10], [-8, -14], [12, 6], [-14, 10], [0, -30], [22, -26], [-24, -12],
        [34, 6], [-36, 4], [16, 30], [-12, 34], [48, -14], [-46, -48], [10, -52],
    ];
    const colors = [0xc0392b, 0xd9a441, 0x6d28d9];
    const buoys = spots.map(([x, z], i) => {
        const mesh = buoyModel(colors[i % colors.length]);
        group.add(mesh);
        return { x, z, vx: 0, vz: 0, y: 0, vy: 0, tiltX: 0, tiltZ: 0, mesh };
    });

    function step(dt, boat, sea) {
        const BOAT_MASS = 6; // bóje má hmotnost 1
        for (const b of buoys) {
            // Kontakt loď–bóje: impuls podél normály rozdělený podle hmotností.
            const dx = b.x - boat.x;
            const dz = b.z - boat.z;
            const min = BUOY_RADIUS + BOAT_RADIUS;
            const d2 = dx * dx + dz * dz;
            if (d2 < min * min && d2 > 0) {
                const d = Math.sqrt(d2);
                const nx = dx / d;
                const nz = dz / d;
                const rel = (b.vx - boat.vx) * nx + (b.vz - boat.vz) * nz; // < 0 = přibližují se
                if (rel < 0) {
                    const j = (-(1 + RESTITUTION) * rel) / (1 + 1 / BOAT_MASS);
                    b.vx += j * nx;
                    b.vz += j * nz;
                    boat.vx -= (j / BOAT_MASS) * nx;
                    boat.vz -= (j / BOAT_MASS) * nz;
                }
                b.x += nx * (min - d);
                b.z += nz * (min - d);
            }

            // Vlny: bóje je lehká, takže hladinu sleduje pružinou (vztlak) s tlumením
            // a sklon hladiny ji pomalu unáší. Sklon měříme ze 4 vzorků kolem ní.
            const hx = (sea(b.x + 1, b.z) - sea(b.x - 1, b.z)) / 2;
            const hz = (sea(b.x, b.z + 1) - sea(b.x, b.z - 1)) / 2;
            b.vy += (40 * (sea(b.x, b.z) - b.y) - 5 * b.vy) * dt;
            b.y += b.vy * dt;
            b.vx -= 2.5 * hx * dt;
            b.vz -= 2.5 * hz * dt;
            // náklon podle sklonu hladiny (vyhlazeně)
            b.tiltX += (Math.atan(hz) * 1.6 - b.tiltX) * Math.min(1, 6 * dt);
            b.tiltZ += (-Math.atan(hx) * 1.6 - b.tiltZ) * Math.min(1, 6 * dt);

            const k = Math.exp(-BUOY_DRAG * dt);
            b.vx *= k;
            b.vz *= k;
            b.x += b.vx * dt;
            b.z += b.vz * dt;
            resolveStatic(b, BUOY_RADIUS, colliders);
        }
    }

    function sync() {
        for (const b of buoys) {
            b.mesh.position.set(b.x, b.y, b.z);
            b.mesh.rotation.x = b.tiltX + b.vz * 0.06;
            b.mesh.rotation.z = b.tiltZ - b.vx * 0.06;
        }
    }

    return { group, step, sync };
}

// Vodní tříšť: pool bodů (THREE.Points). Každá částice letí balisticky
// (gravitace, žádný odpor) a po dopadu na y < 0 nebo po vypršení života zmizí.
// Jeden draw call pro všechny částice; polohy se přepisují v jednom bufferu.
export function createSpray(count = 260) {
    const positions = new Float32Array(count * 3).fill(-999);
    const velocity = new Float32Array(count * 3);
    const life = new Float32Array(count);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const points = new THREE.Points(geometry, new THREE.PointsMaterial({
        color: 0xffffff, size: 0.32, transparent: true, opacity: 0.85, depthWrite: false,
    }));
    points.frustumCulled = false; // bounding box se s pohybem částic nepřepočítává
    points.renderOrder = 3;
    let next = 0;

    function emit(x, y, z, vx, vy, vz) {
        const i = next * 3;
        positions[i] = x; positions[i + 1] = y; positions[i + 2] = z;
        velocity[i] = vx; velocity[i + 1] = vy; velocity[i + 2] = vz;
        life[next] = 0.9 + Math.random() * 0.5;
        next = (next + 1) % count;
    }

    function update(dt, boat) {
        // Od přídě odletuje tříšť do obou stran, tím víc, čím rychleji loď jede.
        const speed = boat.speed;
        if (speed > 4.5 && boat.wet > 0.4) {
            const sin = Math.sin(boat.heading), cos = Math.cos(boat.heading);
            const n = Math.min(4, Math.floor((speed - 3) * 0.4 + Math.random()));
            for (let k = 0; k < n; k++) {
                const side = Math.random() < 0.5 ? -1 : 1;
                const out = (1.5 + Math.random() * 2.5) * side;
                emit(
                    boat.x + sin * 2.4 + cos * 0.5 * side, boat.y + 0.3, boat.z + cos * 2.4 - sin * 0.5 * side,
                    boat.vx * 0.5 + cos * out, 2 + Math.random() * 2.5 + speed * 0.15, boat.vz * 0.5 - sin * out
                );
            }
        }
        for (let p = 0; p < count; p++) {
            if (life[p] <= 0) continue;
            const i = p * 3;
            life[p] -= dt;
            velocity[i + 1] -= 9.81 * dt;
            positions[i] += velocity[i] * dt;
            positions[i + 1] += velocity[i + 1] * dt;
            positions[i + 2] += velocity[i + 2] * dt;
            if (life[p] <= 0 || positions[i + 1] < -0.3) {
                life[p] = 0;
                positions[i + 1] = -999; // schovat pod svět
            }
        }
        geometry.attributes.position.needsUpdate = true;
    }

    // Jednorázový výtrysk (dopad trupu na hladinu po skoku).
    function burst(x, y, z, strength) {
        for (let k = 0; k < 28; k++) {
            const a = Math.random() * Math.PI * 2;
            const r = 1 + Math.random() * 3 * strength;
            emit(x + Math.cos(a), y + 0.2, z + Math.sin(a), Math.cos(a) * r, 2 + Math.random() * 3 * strength, Math.sin(a) * r);
        }
    }

    return { points, update, burst };
}
