import { boatModel } from "./models.js";

// --- Vodorovný pohyb -------------------------------------------------------
// Maximální rychlost vyjde z rovnováhy tahu a odporu: v_max ≈ THRUST / DRAG_FORWARD ≈ 13 j/s.
const THRUST = 9;          // zrychlení při plném plynu
const REVERSE = 5;         // zrychlení při zpátečce
const DRAG_FORWARD = 0.7;  // odpor v ose lodi (malý – loď dojíždí)
const DRAG_SIDE = 3.5;     // odpor do boku (velký – kýl brání smyku)
const TURN_RATE = 1.2;     // rad/s při plné rychlosti
const SLOPE_PUSH = 3.0;    // jak silně loď sjíždí po svahu vlny
export const BOAT_RADIUS = 1.7; // kolizní kružnice

// --- Vztlak ---------------------------------------------------------------
// Trup nesou čtyři plováky (příď, záď, pravobok, levobok). Každý nese čtvrtinu
// váhy, když je ponořený přesně o DRAFT; víc ponořený tlačí nahoru víc, nad
// vodou netlačí vůbec. Z rozdílu sil vpředu/vzadu a vpravo/vlevo vzniká
// kývání – nic se „nepřilepuje“ na hladinu.
const GRAVITY = 9.81;
const DRAFT = 0.35;        // ponor v klidu [m]
const HALF_LENGTH = 2.0;   // vzdálenost plováku přídě/zádi od středu
const HALF_BEAM = 0.9;     // vzdálenost bočních plováků od středu
const HEAVE_DAMP = 5.0;    // tlumení svislého pohybu vodou
const PITCH_K = 2.2, PITCH_DAMP = 4.5;
const ROLL_K = 7.0, ROLL_DAMP = 5.0;
const LEAN_TORQUE = 18.0;  // naklonění do zatáčky
const BOW_WAVE = 0.2;      // kolik vody loď přídí „nahrne“: metry výšky za metr ujeté dráhy

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
// Relativní vztlak plováku: 1 = nese přesně svůj díl váhy, 0 = je nad vodou.
const lift = (depth) => clamp(1 + depth / DRAFT, 0, 2.5);

export function createBoat() {
    const mesh = boatModel();
    mesh.rotation.order = "YXZ"; // nejdřív kurz (Y), pak náklon přídě (X), pak boční náklon (Z)

    const state = {
        // vodorovně
        x: 0, z: 0, vx: 0, vz: 0,
        heading: Math.PI, // rotation.y; π = příď směrem −Z (od kamery)
        speed: 0,         // dopředná složka rychlosti (jen ke čtení)
        // svisle a náklony – simulované, ne odvozené
        y: 0, vy: 0,
        pitch: 0, pitchV: 0, // rotation.x; kladný = příď dolů
        roll: 0, rollV: 0,   // rotation.z; kladný = pravobok nahoru
        wet: 1,              // 0..1, jak moc je trup ve vodě
    };

    // sea(x, z) → výška hladiny; ripples → mřížka, do které loď dělá vlny.
    function step(dt, input, sea, ripples) {
        const sin = Math.sin(state.heading);
        const cos = Math.cos(state.heading);
        const fx = sin, fz = cos;   // jednotkový vektor dopředu
        const rx = cos, rz = -sin;  // jednotkový vektor doprava

        // --- hladina pod čtyřmi plováky ---
        const hBow = sea(state.x + fx * HALF_LENGTH, state.z + fz * HALF_LENGTH);
        const hStern = sea(state.x - fx * HALF_LENGTH, state.z - fz * HALF_LENGTH);
        const hRight = sea(state.x + rx * HALF_BEAM, state.z + rz * HALF_BEAM);
        const hLeft = sea(state.x - rx * HALF_BEAM, state.z - rz * HALF_BEAM);

        // výška plováků podle aktuálního náklonu trupu
        const sp = Math.sin(state.pitch) * HALF_LENGTH;
        const sr = Math.sin(state.roll) * HALF_BEAM;
        const lBow = lift(hBow - (state.y - sp));
        const lStern = lift(hStern - (state.y + sp));
        const lRight = lift(hRight - (state.y + sr));
        const lLeft = lift(hLeft - (state.y - sr));
        const meanLift = (lBow + lStern + lRight + lLeft) / 4;
        state.wet = Math.min(1, meanLift);

        // --- svislý pohyb: vztlak proti gravitaci ---
        // meanLift = 1 → rovnováha; < 1 → padá; > 1 → voda ji vytlačuje.
        const vyBefore = state.vy;
        state.vy += (GRAVITY * (meanLift - 1) - HEAVE_DAMP * state.vy * state.wet) * dt;
        state.y += state.vy * dt;

        // --- náklony: moment z rozdílu vztlaku na protilehlých plovácích ---
        state.pitchV += (-PITCH_K * (lBow - lStern) * GRAVITY / 4 - PITCH_DAMP * state.pitchV
            - input.throttle * 6.0 * state.wet) * dt; // tah motoru zvedá příď
        state.pitch += state.pitchV * dt;
        const lean = input.steer * Math.min(1, Math.abs(state.speed) / 8) * LEAN_TORQUE;
        state.rollV += (ROLL_K * (lRight - lLeft) * GRAVITY / 4 - ROLL_DAMP * state.rollV + lean * state.wet) * dt;
        state.roll += state.rollV * dt;
        state.pitch = clamp(state.pitch, -0.7, 0.7);
        state.roll = clamp(state.roll, -0.7, 0.7);

        // --- vodorovný pohyb ---
        let vf = state.vx * fx + state.vz * fz; // složka v ose lodi
        let vr = state.vx * rx + state.vz * rz; // složka do boku

        // šroub zabírá, jen když je záď ve vodě
        const prop = Math.min(1, lStern);
        vf += input.throttle * (input.throttle > 0 ? THRUST : REVERSE) * prop * dt;

        // sklon hladiny loď unáší z kopce (surfování po vlně)
        vf -= SLOPE_PUSH * ((hBow - hStern) / (2 * HALF_LENGTH)) * state.wet * dt;
        vr -= SLOPE_PUSH * ((hRight - hLeft) / (2 * HALF_BEAM)) * state.wet * dt;

        // odpor vody (ve vzduchu skoro žádný)
        vf *= Math.exp(-DRAG_FORWARD * (0.15 + 0.85 * state.wet) * dt);
        vr *= Math.exp(-DRAG_SIDE * (0.15 + 0.85 * state.wet) * dt);

        // kormidlo účinkuje úměrně rychlosti (při couvání obráceně), jen ve vodě
        let rudder = clamp(vf / 5, -1, 1);
        rudder = rudder >= 0 ? Math.max(rudder, 0.3) : Math.min(rudder, -0.3);
        state.heading += input.steer * TURN_RATE * rudder * prop * dt;

        state.vx = fx * vf + rx * vr;
        state.vz = fz * vf + rz * vr;
        state.x += state.vx * dt;
        state.z += state.vz * dt;
        state.speed = vf;

        // --- loď → voda: příď vodu hrne (kopeček), za zádí zůstává důlek a pěna.
        // Dál už to nese vlnová rovnice v ripples.js – tak vzniká brázda.
        const push = BOW_WAVE * Math.abs(vf) * state.wet * dt;
        const dirSign = vf >= 0 ? 1 : -1;
        if (Math.abs(vf) > 0.3) { // stojící loď hladinu nečeří (a nedrží simulaci vzhůru)
            ripples.splat(state.x + fx * 2.2 * dirSign, state.z + fz * 2.2 * dirSign, push);
            ripples.splat(state.x - fx * 2.4 * dirSign, state.z - fz * 2.4 * dirSign, -push, Math.abs(vf) * 0.6 * state.wet * dt);
        }
        // dopad trupu na hladinu po skoku = šplouchnutí
        if (vyBefore < -1.2 && state.wet > 0.5) {
            ripples.splat(state.x, state.z, vyBefore * 0.05, 0.5);
            state.vy *= 0.6;
        }
    }

    function sync() {
        mesh.position.set(state.x, state.y, state.z);
        mesh.rotation.set(state.pitch, state.heading, state.roll);
        mesh.userData.radar.rotation.y += 0.04; // radar se točí pořád
    }

    return { mesh, state, step, sync };
}
