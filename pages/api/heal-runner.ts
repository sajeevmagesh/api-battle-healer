import type { NextApiRequest, NextApiResponse } from 'next';
import { runHealingAgent } from '../../src/agent';
import { fetchTestApiKey } from '../../src/apiKeys';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Use POST to run the healer agent.' });
  }

  const backendBaseUrl =
    process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';
  const simulateInput = (req.body?.simulate as string) || 'preset';
  const simulate =
    simulateInput === 'random'
      ? pickRandomScenario()
      : simulateInput === 'preset'
        ? 'region_down,retryable_500,schema_drift,repair'
        : simulateInput;

  try {
    const result = await runHealingAgent({
      url: `${backendBaseUrl}/external-api?simulate=${simulate}`,
      options: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transactionId: 'heal-test',
          amount: 1337,
        }),
      },
      regions: [backendBaseUrl, `${backendBaseUrl}?region=eu-west-1`],
      tokenProvider: () => fetchTestApiKey('home-agent'),
      backendBaseUrl,
    });

    return res.status(200).json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unknown agent failure';
    return res.status(500).json({ error: message });
  }
}

const SCENARIO_BUCKETS = [
  ['region_down', 'retryable_500'],
  ['schema_drift', 'repair'],
  ['quota', 'retryable_500'],
  ['schema_drift', 'mock'],
  ['region_down', 'quota', 'retryable_500', 'repair'],
  ['repair'],
];

function pickRandomScenario() {
  const randomCase =
    SCENARIO_BUCKETS[Math.floor(Math.random() * SCENARIO_BUCKETS.length)];
  return randomCase.join(',');
}
