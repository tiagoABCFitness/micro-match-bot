// AI.js
require('dotenv').config();

// Singleton do cliente AzureOpenAI carregado via dynamic import (compatível com CJS)
const getClient = (() => {
    let clientPromise = null;
    return () => {
        if (!clientPromise) {
            clientPromise = (async () => {
                const { AzureOpenAI } = await import('openai'); // <- ESM import
                return new AzureOpenAI({
                    apiKey: process.env.AZURE_OPENAI_API_KEY,
                    endpoint: process.env.AZURE_OPENAI_ENDPOINT,
                    deployment: process.env.AZURE_OPENAI_DEPLOYMENT,
                    apiVersion: process.env.AZURE_OPENAI_API_VERSION || '2025-01-01-preview',
                });
            })();
        }
        return clientPromise;
    };
})();

function safeParseJSON(str) {
    if (!str) return null;
    const clean = String(str).trim()
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/```$/i, '');
    try { return JSON.parse(clean); } catch {}
    // tenta apanhar só o bloco {...}
    const m = clean.match(/\{[\s\S]*\}$/);
    if (m) { try { return JSON.parse(m[0]); } catch {} }
    return null;
}

async function countryFunFact(country) {
    const client = await getClient();
    const resp = await client.chat.completions.create({
        model: process.env.AZURE_OPENAI_DEPLOYMENT,
        messages: [
            { role: 'system', content: 'Responde em Ingles com um único facto curioso, factual e conciso (<= 50 palavras). Pode usar emojis.' },
            { role: 'user', content: `País: ${country}` },
        ],
        temperature: 0.4,
        max_tokens: 90,
    });
    return resp.choices?.[0]?.message?.content?.trim() || null;
}

/** Analisa texto livre e devolve { reply, interests[] } */
async function analyzeInterests(freeText) {
    const client = await getClient();
    const prompt = [
        `Tarefa: extrair gostos/interesses de uma mensagem livre e gerar uma resposta breve.`,
        `Requisitos de saída (STRICT JSON): {"reply": string, "interests": string[]}`,
        `- "reply": 1–2 frases, empática, em ingles, referindo 1–2 pontos do utilizador.`,
        `- "interests": 1 a 5 itens, cada um <= 3 palavras, em minúsculas, sem emojis, sem duplicados.`,
        `- Se não houver dados suficientes, "interests": [].`,
    ].join('\n');

    const resp = await client.chat.completions.create({
        model: process.env.AZURE_OPENAI_DEPLOYMENT,
        temperature: 0.5,
        max_tokens: 300,
        messages: [
            { role: 'system', content: prompt },
            { role: 'user', content: freeText },
            { role: 'user', content: 'Responde APENAS com JSON válido.' },
        ],
    });

    const raw = resp.choices?.[0]?.message?.content || '';
    const json = safeParseJSON(raw);
    if (!json || !Array.isArray(json.interests)) {
        return { reply: 'Podes contar-me um pouco mais sobre os teus interesses?', interests: [] };
    }

    // normalização leve
    const uniq = Array.from(new Set(json.interests.map(s => String(s).trim().toLowerCase()).filter(Boolean)));
    return { reply: json.reply?.trim() || '', interests: uniq.slice(0, 7) };
}

module.exports = { countryFunFact, analyzeInterests };