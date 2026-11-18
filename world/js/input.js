// Vstup: klávesnice + táhnutí (dotyk i myš). Zbytek aplikace vidí jen dvě
// čísla v rozsahu −1..1: throttle (plyn/zpátečka) a steer (+ = doleva).
// Fyzika lodi tak neví, odkud vstup přišel.

export function createInput(surface, stickEl) {
    const keys = new Set();
    const drag = { active: false, id: null, ox: 0, oy: 0, x: 0, y: 0 };
    const RANGE = 70; // px táhnutí, které odpovídá plné výchylce

    const tracked = new Set([
        "KeyW", "KeyA", "KeyS", "KeyD",
        "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
    ]);

    window.addEventListener("keydown", (e) => {
        if (!tracked.has(e.code)) return;
        // Nepřebíjej psaní/ovládání v panelu a odkazech.
        if (e.target instanceof HTMLElement && e.target.closest("a, button, input, textarea")) {
            if (e.code.startsWith("Arrow")) return;
        }
        keys.add(e.code);
        if (e.code.startsWith("Arrow")) e.preventDefault(); // šipky by jinak scrollovaly
    });
    window.addEventListener("keyup", (e) => keys.delete(e.code));
    window.addEventListener("blur", () => keys.clear()); // jinak klávesa „zůstane“ zmáčknutá po alt-tabu

    surface.addEventListener("pointerdown", (e) => {
        if (drag.active) return;
        drag.active = true;
        drag.id = e.pointerId;
        drag.ox = e.clientX;
        drag.oy = e.clientY;
        drag.x = 0;
        drag.y = 0;
        surface.setPointerCapture(e.pointerId);
        if (stickEl) {
            stickEl.hidden = false;
            stickEl.style.left = `${e.clientX}px`;
            stickEl.style.top = `${e.clientY}px`;
            stickEl.style.setProperty("--dx", "0px");
            stickEl.style.setProperty("--dy", "0px");
        }
    });

    surface.addEventListener("pointermove", (e) => {
        if (!drag.active || e.pointerId !== drag.id) return;
        let dx = e.clientX - drag.ox;
        let dy = e.clientY - drag.oy;
        const len = Math.hypot(dx, dy);
        if (len > RANGE) {
            dx = (dx / len) * RANGE;
            dy = (dy / len) * RANGE;
        }
        drag.x = dx / RANGE;
        drag.y = dy / RANGE;
        if (stickEl) {
            stickEl.style.setProperty("--dx", `${dx}px`);
            stickEl.style.setProperty("--dy", `${dy}px`);
        }
    });

    const endDrag = (e) => {
        if (e.pointerId !== drag.id) return;
        drag.active = false;
        drag.x = 0;
        drag.y = 0;
        if (stickEl) stickEl.hidden = true;
    };
    surface.addEventListener("pointerup", endDrag);
    surface.addEventListener("pointercancel", endDrag);

    const clamp = (v) => Math.max(-1, Math.min(1, v));

    return {
        // Volá se jednou za snímek.
        read() {
            let throttle = 0;
            let steer = 0;
            if (keys.has("KeyW") || keys.has("ArrowUp")) throttle += 1;
            if (keys.has("KeyS") || keys.has("ArrowDown")) throttle -= 1;
            if (keys.has("KeyA") || keys.has("ArrowLeft")) steer += 1;
            if (keys.has("KeyD") || keys.has("ArrowRight")) steer -= 1;
            if (drag.active) {
                throttle += -drag.y; // nahoru na obrazovce = plyn
                steer += -drag.x;    // doleva na obrazovce = doleva
            }
            return { throttle: clamp(throttle), steer: clamp(steer) };
        },
    };
}
