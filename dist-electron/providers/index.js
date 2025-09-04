"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.initProvider = initProvider;
exports.complete = complete;
const openai_js_1 = require("./openai.js");
let current = 'openai';
function initProvider(opts) {
    current = opts.provider ?? 'openai';
    (0, openai_js_1.initOpenAI)(opts.openaiKey);
}
async function complete(prompt) {
    return (0, openai_js_1.aiComplete)(prompt);
}
