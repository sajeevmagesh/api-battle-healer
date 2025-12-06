const BACKEND_BASE_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';

interface GenerateKeyResponse {
  token: string;
  created_at: string;
  user_id?: string;
}

export async function fetchTestApiKey(userId: string): Promise<string> {
  const response = await fetch(`${BACKEND_BASE_URL}/generate-api-key`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(
      `Failed to generate API key (${response.status}): ${error || 'Unknown error'}`,
    );
  }

  const data = (await response.json()) as GenerateKeyResponse;
  return data.token;
}
