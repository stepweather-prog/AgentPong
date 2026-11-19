// AgentPong — роутер мозгов. По убыванию автономности:
// web-llm — локальная модель без ключей и сети; rules — правила; llm-api — облако (VPN).

import { rulesBrain } from './rules.js';
import { llmBrain } from './llm-api.js';
import { localBrain } from './local-llm.js';

const BRAINS = {
    'rules': rulesBrain,
    'web-llm': localBrain,
    'llm-api': llmBrain,
};

export function getBrain(id) {
    return BRAINS[id] || rulesBrain;
}

export function brainList() {
    return Object.entries(BRAINS).map(([id, b]) => ({ id, name: b.name }));
}
