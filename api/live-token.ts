import { GoogleGenAI, Modality } from '@google/genai';

const MODEL = 'gemini-3.1-flash-live-preview';

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'GEMINI_API_KEY is not configured in Vercel.' });
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    const token = await ai.authTokens.create({
      config: {
        uses: 1,
        expireTime: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        newSessionExpireTime: new Date(Date.now() + 60 * 1000).toISOString(),
        liveConnectConstraints: {
          model: MODEL,
          config: {
            responseModalities: [Modality.AUDIO],
            sessionResumption: {},
          },
        },
      },
    });

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ token: token.name, expiresInSeconds: 1800 });
  } catch (error: any) {
    console.error('[live-token]', error?.message ?? error);
    return res.status(502).json({ error: 'Unable to provision Gemini Live access.' });
  }
}
