// Texty pro oba jazyky. Jediné místo, kde se mění obsah – svět (ostrovy,
// cedule, panel) se z něj generuje. Pořadí sekcí = pořadí v navigaci.

const EMAIL = "stepan.meszaros@gmail.com";
const LINKEDIN = "https://www.linkedin.com/in/%C5%A1t%C4%9Bp%C3%A1n-m%C3%A9sz%C3%A1ros-2b60b124b/";

const entry = (title, when, where, what = "") => `
    <article class="entry">
        <header><h3>${title}</h3>${when ? `<span class="when">${when}</span>` : ""}</header>
        ${where ? `<p class="where">${where}</p>` : ""}
        ${what ? `<p>${what}</p>` : ""}
    </article>`;

export const content = {
    en: {
        ui: {
            title: "Štěpán Mészáros – 3D portfolio",
            role: "Backend developer",
            introLede: "Sail around the fjord. Each island is one part of my CV.",
            start: "Start sailing",
            loading: "Loading…",
            sceneHelp: "Interactive 3D scene. Steer the boat with W, A, S, D or the arrow keys and sail into a ring next to an island to open that section. Every section is also available from the Sections buttons without sailing.",
            classic: "Classic version",
            classicHref: "../",
            langLabel: "CS",
            langHref: "?lang=cs",
            hintKeys: "W A S D or arrow keys to sail · drag on touch screens",
            sail: "sail",
            reset: "reset",
            dragHint: "or drag anywhere",
            approach: "Sail into the ring to dock",
            docked: "Docked",
            visited: "islands visited",
            qualityHigh: "Quality: high",
            qualityLow: "Quality: low",
            qualityAuto: "Low frame rate – switched to low quality.",
            allSeen: "You have visited every island.",
            allSeenCta: "Get in touch",
            prev: "Previous section",
            next: "Next section",
            unit: "kn",
            compass: ["N", "NE", "E", "SE", "S", "SW", "W", "NW"],
            sights: {
                preikestolen: "Pulpit Rock – a flat cliff 604 m above Lysefjord, a day trip from Stavanger.",
                kjerag: "Kjeragbolten – a boulder wedged in a crevice 984 m above Lysefjord.",
            },
            sections: "Sections",
            close: "Close",
            noWebgl: "Your browser could not start WebGL, so the 3D world is not available.",
        },
        sections: [
            {
                id: "about",
                title: "About",
                html: `
                    <p>I'm a student of Applied Informatics (Software Engineering) at the University of Hradec
                    Králové in Czechia. Since October 2025 I've been working part-time as a backend developer
                    on a smart-home design platform, alongside my studies.</p>
                    <p>I'm most interested in how backend systems behave once data starts moving between
                    services: messaging, consistency and failure handling.</p>
                    <p>This semester I'm on an Erasmus+ exchange in Stavanger, Norway, where I'm taking a course
                    in software security – threat modelling, secure design and penetration testing of a
                    vulnerable web application.</p>
                    <p>I speak Czech natively and English at B2 level.</p>`,
            },
            {
                id: "experience",
                title: "Experience",
                html:
                    entry("Junior Backend Developer", "Oct 2025 – now", "part-time · Brno, hybrid") +
                    entry(`<a href="https://shai.tech" target="_blank" rel="noopener">shai.tech</a>`, "Sep 2026 – now", "",
                        "Backend development of SHAI Studio, a smart-home design platform: services, APIs and data processing. Code reviews and work in a product team.") +
                    entry("Smarteon Systems s.r.o.", "Oct 2025 – now", "",
                        "Backend development of smart-home software in the company's development team.") +
                    entry("IT Helpdesk", "2023 – 2024", "SŠ a VOŠ aplikované kybernetiky · part-time",
                        "Technical support for students and teachers, hardware and software troubleshooting."),
            },
            {
                id: "education",
                title: "Education",
                html:
                    entry("University of Hradec Králové", "2025 – 2028", "Bachelor's, Applied Informatics (Software Engineering)") +
                    entry("University of Stavanger, Norway", "Autumn 2026", "Erasmus+ exchange semester") +
                    entry("SŠ a VOŠ aplikované kybernetiky", "2021 – 2025", "Secondary school, Computer Programming") +
                    `<h3 class="sub">Certificates</h3>` +
                    entry("Enterprise Networking, Security, and Automation", "", "Cisco Networking Academy · CCNA curriculum course") +
                    entry("Linux Essentials", "", "Cisco Networking Academy · course"),
            },
            {
                id: "skills",
                title: "Skills",
                html: `
                    <dl class="skills">
                        <dt>Languages</dt><dd>Kotlin, Python, TypeScript, SQL, C#</dd>
                        <dt>Backend</dt><dd>Ktor, PostgreSQL, Kafka, Docker, REST APIs</dd>
                        <dt>Tools &amp; other</dt><dd>React, Git, Linux, IntelliJ IDEA, Cisco networking</dd>
                    </dl>`,
            },
            {
                id: "contact",
                title: "Contact",
                html: `
                    <p>The fastest way to reach me is by email.</p>
                    <p><a href="mailto:${EMAIL}">${EMAIL}</a></p>
                    <p><a href="${LINKEDIN}" target="_blank" rel="noopener">LinkedIn ↗</a></p>`,
            },
        ],
    },

    cs: {
        ui: {
            title: "Štěpán Mészáros – 3D portfolio",
            role: "Backend vývojář",
            introLede: "Proplujte se fjordem. Každý ostrov je jedna část mého životopisu.",
            start: "Vyplout",
            loading: "Načítám…",
            sceneHelp: "Interaktivní 3D scéna. Loď se řídí klávesami W, A, S, D nebo šipkami; vplutím do kruhu u ostrova se otevře příslušná sekce. Všechny sekce jsou dostupné i tlačítky v navigaci bez řízení lodi.",
            classic: "Klasická verze",
            classicHref: "../cs/",
            langLabel: "EN",
            langHref: "?lang=en",
            hintKeys: "W A S D nebo šipky · na dotykové obrazovce táhněte prstem",
            sail: "plavba",
            reset: "návrat na start",
            dragHint: "nebo táhněte kdekoli",
            approach: "Vplujte do kruhu a zakotvěte",
            docked: "Zakotveno",
            visited: "ostrovů navštíveno",
            qualityHigh: "Kvalita: vysoká",
            qualityLow: "Kvalita: nízká",
            qualityAuto: "Nízká snímková frekvence – přepnuto na nízkou kvalitu.",
            allSeen: "Navštívili jste všechny ostrovy.",
            allSeenCta: "Napište mi",
            prev: "Předchozí sekce",
            next: "Další sekce",
            unit: "uzlů",
            compass: ["S", "SV", "V", "JV", "J", "JZ", "Z", "SZ"],
            sights: {
                preikestolen: "Kazatelna – plochý útes 604 m nad Lysefjordem, výlet na den ze Stavangeru.",
                kjerag: "Kjeragbolten – balvan zaklíněný v průrvě 984 m nad Lysefjordem.",
            },
            sections: "Sekce",
            close: "Zavřít",
            noWebgl: "Prohlížeči se nepodařilo spustit WebGL, takže 3D svět není dostupný.",
        },
        sections: [
            {
                id: "about",
                title: "O mně",
                html: `
                    <p>Studuji aplikovanou informatiku (softwarové inženýrství) na Univerzitě Hradec Králové.
                    Od října 2025 při studiu pracuji na částečný úvazek jako backend vývojář na platformě
                    pro návrh chytrých domácností.</p>
                    <p>Nejvíc mě zajímá, jak se backendové systémy chovají, když mezi službami začnou putovat
                    data: zasílání zpráv, konzistence a zvládání chyb.</p>
                    <p>Tento semestr jsem na výměně Erasmus+ ve Stavangeru v Norsku, kde studuji bezpečnost
                    softwaru – modelování hrozeb, bezpečný návrh a penetrační testování zranitelné webové
                    aplikace.</p>
                    <p>Česky mluvím rodilě, anglicky na úrovni B2.</p>`,
            },
            {
                id: "experience",
                title: "Praxe",
                html:
                    entry("Junior Backend Developer", "10/2025 – dosud", "částečný úvazek · Brno, hybridně") +
                    entry(`<a href="https://shai.tech" target="_blank" rel="noopener">shai.tech</a>`, "9/2026 – dosud", "",
                        "Backendový vývoj SHAI Studia, platformy pro návrh chytrých domácností: služby, API a zpracování dat. Code review a práce v produktovém týmu.") +
                    entry("Smarteon Systems s.r.o.", "10/2025 – dosud", "",
                        "Backendový vývoj softwaru pro chytré domácnosti ve vývojovém týmu firmy.") +
                    entry("IT helpdesk", "2023 – 2024", "SŠ a VOŠ aplikované kybernetiky · částečný úvazek",
                        "Technická podpora pro studenty a učitele, řešení HW a SW problémů."),
            },
            {
                id: "education",
                title: "Vzdělání",
                html:
                    entry("Univerzita Hradec Králové", "2025 – 2028", "Bc., aplikovaná informatika (softwarové inženýrství)") +
                    entry("University of Stavanger, Norsko", "podzim 2026", "Výměnný semestr Erasmus+") +
                    entry("SŠ a VOŠ aplikované kybernetiky", "2021 – 2025", "Střední škola, obor Programování") +
                    `<h3 class="sub">Certifikáty</h3>` +
                    entry("Enterprise Networking, Security, and Automation", "", "Cisco Networking Academy · kurz z osnov CCNA") +
                    entry("Linux Essentials", "", "Cisco Networking Academy · kurz"),
            },
            {
                id: "skills",
                title: "Dovednosti",
                html: `
                    <dl class="skills">
                        <dt>Jazyky</dt><dd>Kotlin, Python, TypeScript, SQL, C#</dd>
                        <dt>Backend</dt><dd>Ktor, PostgreSQL, Kafka, Docker, REST API</dd>
                        <dt>Nástroje a další</dt><dd>React, Git, Linux, IntelliJ IDEA, sítě Cisco</dd>
                    </dl>`,
            },
            {
                id: "contact",
                title: "Kontakt",
                html: `
                    <p>Nejrychleji mě zastihnete e-mailem.</p>
                    <p><a href="mailto:${EMAIL}">${EMAIL}</a></p>
                    <p><a href="${LINKEDIN}" target="_blank" rel="noopener">LinkedIn ↗</a></p>`,
            },
        ],
    },
};
