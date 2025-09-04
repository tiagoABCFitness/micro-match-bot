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

module.exports = { countryFunFact };