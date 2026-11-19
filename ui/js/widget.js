// AgentPong — повадки Скряги в виджет-режиме:
// ворчание на перетаскивание, прятание в трей и возврат.

const DRAG_GRUMBLES = [
    { t: 'Эй-эй! Куда тащишь?! Меня ещё и не грузили бесплатно!', e: 'annoyed' },
    { t: 'Тяжело-а-а... байты сами себя не перетащат.', e: 'eyes-shut' },
    { t: 'Так, плати за карго... а, у нас бесплатный тариф. Ну нормально в общем.', e: 'scheming' },
    { t: 'Перелёт! Самый дешёвый — на мне и верхом.', e: 'strut' },
];

const HIDE_GRUMBLES = [
    { t: 'В трей?! Чего уж... там сквозняки и никакого света.', e: 'outrage-point' },
    { t: 'Прячешь меня, как мелочь от жены. Мне это по нраву.', e: 'sneaky' },
    { t: 'Ну-ну. Я ещё здесь — просто тише, чем твой VPN.', e: 'check' },
];

const SHOW_GRUMBLES = [
    { t: 'А-а, живой. И не прихлопнул — даже приятно.', e: 'accuse' },
    { t: 'Достали меня из трея. Ненавижу... нет, вроде люблю. Неопределённость.', e: 'shrug' },
    { t: 'Извините, был в трее — досматривал сны про сервера.', e: 'greet' },
];

const rand = (a) => a[Math.floor(Math.random() * a.length)];

let lastGrumble = 0;

export function initWidget(agentSay) {   // agentSay(text, emotion) — из main.js
    if (!window.apWidget) return false;  // не виджет — обычный браузер
    document.body.classList.add('widget');

    // кнопки в окне виджета
    addWidgetButtons(agentSay);

    window.apWidget.onMove(() => {
        const now = Date.now();
        if (now - lastGrumble < 5000) return;
        lastGrumble = now;
        if (Math.random() < 0.6) {
            const g = rand(DRAG_GRUMBLES);
            agentSay(g.t, g.e);
        }
    });

    window.apWidget.onHide((ev) => {
        const g = rand(HIDE_GRUMBLES);
        // говорим ДО прятания окна — окно ещё видно, звук проходит
        agentSay(g.t, g.e);
    });

    window.apWidget.onShow(() => {
        const now = Date.now();
        if (now - lastGrumble < 3000) return;
        lastGrumble = now;
        const g = rand(SHOW_GRUMBLES);
        agentSay(g.t, g.e);
    });

    return true;
}

function addWidgetButtons(agentSay) {
    const bar = document.createElement('div');
    bar.id = 'widget-bar';
    const min = document.createElement('button');
    min.textContent = '—';
    min.title = 'Спрятать в трей';
    min.onclick = () => window.apWidget.minimize();
    const close = document.createElement('button');
    close.textContent = '✕';
    close.title = 'Выход';
    close.onclick = () => window.apWidget.quit();
    bar.append(min, close);
    document.getElementById('agent-slot').appendChild(bar);
}
