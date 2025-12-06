import type { NextApiRequest, NextApiResponse } from 'next';

type ErrorResponse = { error: string };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<unknown | ErrorResponse>,
) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res
      .status(405)
      .json({ error: 'Method not allowed. Use POST with a message payload.' });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res
      .status(500)
      .json({ error: 'OPENAI_API_KEY is not configured on the server.' });
  }

  const { message } = req.body ?? {};
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'Missing string "message" field.' });
  }

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'You are a concise helper bot.' },
          { role: 'user', content: message },
        ],
        temperature: 0.2,
      }),
    });

    const data = await response.json();
    return res.status(response.status).json(data);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unknown OpenAI fetch error';
    return res.status(502).json({ error: message });
  }
}
