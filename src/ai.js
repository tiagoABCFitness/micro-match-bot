// AI.js
import 'dotenv/config';
import { AzureOpenAI } from 'openai';

const client = new AzureOpenAI({
    apiKey: process.env.AZURE_OPENAI_API_KEY,
    endpoint: process.env.AZURE_OPENAI_ENDPOINT,
    deployment: process.env.AZURE_OPENAI_DEPLOYMENT,
    apiVersion: process.env.AZURE_OPENAI_API_VERSION || '2025-01-01-preview',
});

export class AI {
    /**
     * Devolve UMA curiosidade curta e verificável sobre o país pedido.
     * - 1 a 2 frases no máx.
     * - Sem emojis, sem formatação extra.
     */
    static async countryFunFact(country) {
        const messages = [
            {
                role: 'system',
                content:
                    'You are a concise assistant. Reply with exactly one interesting, factual, non-obvious fun fact about the given country, in English. Max 50 words. Emojis are allowed.',
            },
            {
                role: 'user',
                content: `Provide me a curious fact about ${country}.`,
            },
        ];

        const resp = await client.chat.completions.create({
            model: process.env.AZURE_OPENAI_DEPLOYMENT,
            messages,
            temperature: 0.4,
            max_tokens: 90,
        });

        const txt = resp.choices?.[0]?.message?.content?.trim();
        return txt || 'No fact available.';
    }
}
