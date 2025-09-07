// AI.js
require('dotenv').config();

// Singleton do cliente AzureOpenAI carregado via dynamic import (compatível com CJS)
const getClient = (() => {
    let clientPromise = null;
    return () => {
        if (!clientPromise) {
            clientPromise = (async () => {
                const { AzureOpenAI } = await import('openai');
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

    const uniq = Array.from(new Set(json.interests.map(s => String(s).trim().toLowerCase()).filter(Boolean)));
    return { reply: json.reply?.trim() || '', interests: uniq.slice(0, 7) };
}

// --- nova função IA para sugestões culturais ---
async function culturalTopicSuggestions(countryRaw, max = 5) {
    const client = await getClient();
    const country = (countryRaw || 'your country').toString().trim();

    const prompt = [
        `Task: propose up to ${max} cultural discussion topics for someone living in "${country}".`,
        `Output STRICT JSON as: {"topics": string[]}`,
        `Guidelines:`,
        `- Each topic: 1–3 words, lowercase, no emojis.`,
        `- Diverse mix (e.g., food, music, festivals, sports, literature, cinema, landmarks, traditions).`,
        `- Avoid duplicates or ultra-generic terms like "culture".`,
        `- No explanations, JSON only.`
    ].join('\n');

    const resp = await client.chat.completions.create({
        model: process.env.AZURE_OPENAI_DEPLOYMENT,
        temperature: 0.7,
        max_tokens: 150,
        messages: [
            { role: 'system', content: prompt },
            { role: 'user', content: `country: ${country}` },
            { role: 'user', content: 'Return JSON only.' }
        ],
    });

    const raw = resp.choices?.[0]?.message?.content || '';
    const json = safeParseJSON(raw);
    const topics = Array.isArray(json?.topics) ? json.topics : [];

    const clean = Array.from(new Set(
        topics.map(s => String(s).trim().toLowerCase()).filter(Boolean)
    )).slice(0, max);

    return clean;
}

/** Normaliza/agrupa tópicos semelhantes → categoria canónica */
async function canonicalizeTopics(topics) {
    if (!Array.isArray(topics) || !topics.length) return {};
    const client = await getClient();

    const system = `You normalize user interest topics to canonical categories.\n- Merge synonyms, brands, subdisciplines into a parent category when it helps matching.\n- Examples: [fitness, pilates, yoga] => fitness; [nintendo, playstation, xbox, gaming] => gaming; [soccer, futebol] => football; [cinema, movies, film] => movies.\n- Keep category names concise (singular nouns when natural), lowercase, ASCII only.\n- If a topic is already canonical, keep it.\n- Output a single JSON object mapping each ORIGINAL topic (as given) to a CANONICAL category.\n- Include ALL given topics as keys.\n- Do not add extra commentary.`;

    const user = `Topics to normalize (comma-separated):\n${topics.join(', ')}`;

    const resp = await client.chat.completions.create({
        model: process.env.AZURE_OPENAI_DEPLOYMENT,
        temperature: 0.2,
        max_tokens: 500,
        messages: [
            { role: 'system', content: system },
            { role: 'user', content: user }
        ]
    });

    const text = resp.choices?.[0]?.message?.content?.trim() || '{}';
    const mapping = safeParseJSON(text) || {};

    for (const t of topics) {
        if (!mapping[t]) mapping[t] = String(t).trim().toLowerCase();
        else mapping[t] = String(mapping[t]).trim().toLowerCase();
    }
    return mapping;
}

/** Gera 3 ice breakers curtos em inglês sobre um tópico */
async function generateIceBreakers(topic, count = 3) {
    const client = await getClient();

    const prompt = [
        `Task: create ${count} ice breaker questions about the topic "${topic}".`,
        `Guidelines:`,
        `- Respond ONLY with valid JSON: {"questions": string[]}`,
        `- Each question in English, max 15 words.`,
        `- Make them casual, fun, good for group conversation.`,
        `- No numbering, no explanations, just the array.`
    ].join('\n');

    const resp = await client.chat.completions.create({
        model: process.env.AZURE_OPENAI_DEPLOYMENT,
        temperature: 0.7,
        max_tokens: 150,
        messages: [
            { role: 'system', content: prompt },
            { role: 'user', content: `topic: ${topic}` },
            { role: 'user', content: 'Return JSON only.' }
        ],
    });

    const raw = resp.choices?.[0]?.message?.content || '';
    const json = safeParseJSON(raw);
    const questions = Array.isArray(json?.questions) ? json.questions : [];

    return questions.slice(0, count);
}

/**
 * Decide se o utilizador quer atualizar interesses (change_interests)
 * ou se é apenas small talk. Produz também uma resposta curta e calorosa.
 * Retorna: { intent: 'change_interests'|'smalltalk'|'other', reply: string }
 */
async function detectUserIntent(userText, countryRaw) {
    const client = await getClient();
    const country = (countryRaw || '').toString().trim();

    const system = [
        'You are a friendly Slack bot. Classify the user message and craft a warm one-line reply in English.',
        'Output STRICT JSON: {"intent":"change_interests"|"smalltalk"|"other","reply":string}',
        'Rules:',
        '- "change_interests": user asks to change/update/add/remove interests/topics OR lists new topics.',
        '- "smalltalk": thanks, greetings, appreciation, unrelated chitchat.',
        '- "other": anything else.',
        '- "reply": one of few sentence, warm, natural, <= 100 words, can use emojis.',
        country
            ? `- If helpful, personalize gently with the country "${country}" in a positive, non-stereotyped way (e.g., "Hope things are going well in ${country}.").`
            : '- Avoid stereotypes. No assumptions beyond what is said.'
    ].join('\n');

    const resp = await client.chat.completions.create({
        model: process.env.AZURE_OPENAI_DEPLOYMENT,
        temperature: 0.5,
        max_tokens: 150,
        messages: [
            { role: 'system', content: system },
            { role: 'user', content: userText },
            { role: 'user', content: 'Return JSON only.' }
        ]
    });

    const raw = resp.choices?.[0]?.message?.content || '';
    const json = safeParseJSON(raw) || {};
    const intent = ['change_interests','smalltalk','other'].includes(json.intent) ? json.intent : 'other';
    const reply = (json.reply || '').toString().trim();

    return { intent, reply };
}


module.exports = { countryFunFact, analyzeInterests, culturalTopicSuggestions, canonicalizeTopics, generateIceBreakers, detectUserIntent };
