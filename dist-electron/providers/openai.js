"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.initOpenAI = initOpenAI;
exports.aiComplete = aiComplete;
const openai_1 = require("openai");
let client = null;
function initOpenAI(apiKey) {
    if (!apiKey)
        return;
    client = new openai_1.default({ apiKey });
}
async function aiComplete(prompt, system = 'You are a helpful coding assistant.') {
    if (!client)
        throw new Error('OpenAI not configured');
    // Basic Responses API call: adjust model as needed
    const res = await client.responses.create({
        model: 'gpt-4.1-mini',
        input: [
            { role: 'system', content: system },
            { role: 'user', content: prompt }
        ]
    });
    // Normalize text output
    const text = res.output_text ?? '';
    return text;
}
