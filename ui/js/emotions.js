// AgentPong — карта эмоций агента, источник: Asset/ASSETS.md
// Тег -> путь к кадру. Кадры одного листа выровнены, годятся для смены.

const F = (sheet, frame, tag) =>
    (tag === 'EMPTY')
        ? null
        : `../Asset/frames/sheet-${sheet}/sheet-${sheet}-frame-${frame}-${tag}.webp`;

export const EMOTIONS = {
    // события -> кадр (sheet, frame, tag)
    greet:     F('04', '04', 'greet'),        // поздоровался
    farewell:  F('02', '08', 'walk-off'),     // уходит нехотя
    thanks:    F('02', '04', 'laugh-open'),   // поблагодарили
    laugh:     F('04', '05', 'rofl-point'),
    mocking:   F('03', '04', 'mocking'),
    gotcha:    F('02', '06', 'gotcha'),       // сарказм, подловил
    doubt:     F('04', '09', 'doubt'),
    idk:       F('01', '01', 'idk'),
    think:     F('04', '03', 'hard-think'),
    eureka:    F('04', '06', 'eureka'),
    sorry:     F('04', '01', 'sad'),
    stern:     F('03', '03', 'stern'),
    annoyed:   F('01', '03', 'annoyed'),
    accuse:    F('03', '05', 'accuse'),
    shrug:     F('01', '07', 'shrug'),
    scheming:  F('03', '06', 'scheming'),
    sneaky:    F('03', '08', 'sneaky'),
    waiting:   F('03', '09', 'waiting'),
    check:     F('01', '02', 'check'),
    proud:     F('02', '03', 'serious'),
    neutral:   null,                          // idle-позы agent/
};

// idle-позы: база + подмигивания-переливы
export const IDLE = [
    '../Asset/agent/agent-01-idle.webp',
    '../Asset/agent/agent-03-idle-near-2.webp',
    '../Asset/agent/agent-05-idle-near-4.webp',
];

export function srcOf(key) {
    return EMOTIONS[key] || null;
}
