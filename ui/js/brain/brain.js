// AgentPong — роутер мозгов. Трамвайные пути: rules | llm-api.
// Смена движка — один селектор, интерфейс общий: respond(input, history) -> {text, emotion}

import { rulesBrain } from './rules.js';
import { llmBrain } from './llm-api.js';
import { deepseekBrain } from './deepseek.js';

const BRAINS = {
    'rules': rulesBrain,
    'deepseek': deepseekBrain,
    'llm-api': llmBrain,
};

export function getBrain(id) {
    return BRAINS[id] || rulesBrain;
}

export function brainList() {
    return Object.entries(BRAINS).map(([id, b]) => ({ id, name: b.name }));
}
