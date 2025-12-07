import { useCallback, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  Clock,
  FlaskConical,
  Globe,
  Key,
  RefreshCw,
  Shield,
  Sparkles,
} from 'lucide-react';
import EndpointMap from '@/components/dashboard/EndpointMap';
import HealingTimeline from '@/components/dashboard/HealingTimeline';
import LiveActivityFeed from '@/components/dashboard/LiveActivityFeed';
import QuotaGauge from '@/components/dashboard/QuotaGauge';
import RecoveryQueuePanel from '@/components/dashboard/RecoveryQueuePanel';
import SimulationPanel from '@/components/dashboard/SimulationPanel';
import SmartFetchMonitor from '@/components/dashboard/SmartFetchMonitor';
import CredentialRotator from '@/components/dashboard/CredentialRotator';
import { Button } from '@/components/ui/button';
import {
  deriveCredentialPool,
  deriveEndpointHealth,
  deriveHealingLogs,
  deriveLiveEvents,
  deriveQuotaUsage,
  deriveRecoveryQueue,
  type SmartFetchWithTimestamp,
} from '@/utils/dashboard';
import { fetchTestApiKey } from '@/apiKeys';
import type { HealingAgentResult } from '@/agent/types';
import { smartFetch } from '@/smartFetch';

const backendBaseUrl =
  process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';

const scenarioToSimulateFlag: Record<string, string> = {
  '5xx_burst': 'retryable_500',
  rate_limit: 'quota',
  region_outage: 'region_down',
  credential_expire: 'repair',
  schema_drift: 'schema_drift',
  full_cascade: 'region_down,retryable_500,schema_drift,repair',
};

const healingScenarioOptions = [
  { value: 'preset', label: 'Full cascade' },
  { value: 'region_down,retryable_500', label: 'Region failover' },
  { value: 'schema_drift,repair', label: 'Schema drift + repair' },
  { value: 'quota,retryable_500', label: 'Quota exhaustion' },
  { value: 'mock', label: 'Graceful mock' },
  { value: 'repair', label: 'Payload repair only' },
  { value: 'random', label: 'Random mix' },
];

const scenarioTabs = [
  { id: 'overview', label: 'Overview', icon: BarChart3 },
  { id: 'recovery', label: 'Recovery', icon: Clock },
  { id: 'credentials', label: 'Credentials', icon: Key },
  { id: 'simulation', label: 'Simulation', icon: FlaskConical },
];

async function refreshToken(previousToken?: string | null) {
  const response = await fetch(`${backendBaseUrl}/refresh-token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      previous_token: previousToken,
      requested_by: 'resilience-dashboard',
    }),
  });
  if (!response.ok) {
    throw new Error('Token refresh failed');
  }
  const data = (await response.json()) as { token: string };
  return data.token;
}

export default function ResilienceHubPage() {
  const [activeTab, setActiveTab] = useState('overview');
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [keyLoading, setKeyLoading] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);

  const [healingScenario, setHealingScenario] = useState('preset');
  const [healingLoading, setHealingLoading] = useState(false);
  const [healingError, setHealingError] = useState<string | null>(null);
  const [healingResult, setHealingResult] = useState<HealingAgentResult | null>(
    null,
  );

  const [smartFetchRequests, setSmartFetchRequests] = useState<
    SmartFetchWithTimestamp[]
  >([]);
  const [isSimulating, setIsSimulating] = useState(false);
  const [simulationError, setSimulationError] = useState<string | null>(null);

  const handleGenerateKey = useCallback(async () => {
    setKeyLoading(true);
    setKeyError(null);
    try {
      const token = await fetchTestApiKey('resilience-dashboard');
      setApiKey(token);
    } catch (error) {
      setKeyError(
        error instanceof Error ? error.message : 'Unable to generate key',
      );
    } finally {
      setKeyLoading(false);
    }
  }, []);

  const handleRotateCredentials = useCallback(async () => {
    try {
      const token = await refreshToken(apiKey);
      setApiKey(token);
    } catch (error) {
      setKeyError(
        error instanceof Error ? error.message : 'Credential rotation failed',
      );
    }
  }, [apiKey]);

  const handleRunHealingAgent = useCallback(async () => {
    setHealingLoading(true);
    setHealingError(null);
    setHealingResult(null);
    try {
      const response = await fetch('/api/heal-runner', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ simulate: healingScenario }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'Healer failed');
      }
      setHealingResult(payload as HealingAgentResult);
    } catch (error) {
      setHealingError(
        error instanceof Error ? error.message : 'Healer run failed',
      );
    } finally {
      setHealingLoading(false);
    }
  }, [healingScenario]);

  const runSmartFetchScenario = useCallback(
    async (config: { scenario: string; autoHeal: boolean }) => {
      const simulateParams =
        scenarioToSimulateFlag[config.scenario] ||
        scenarioToSimulateFlag.full_cascade;
      setSimulationError(null);
      setIsSimulating(true);

      try {
        let activeToken = apiKey ?? (await fetchTestApiKey('smart-fetch'));
        if (!apiKey) {
          setApiKey(activeToken);
        }

        const simulateQuery = simulateParams ? `?simulate=${simulateParams}` : '';
        const regions = [
          backendBaseUrl,
          `${backendBaseUrl}?region=eu-west-1`,
        ];

        for (let i = 0; i < 3; i += 1) {
          const result = await smartFetch<Record<string, unknown>>(
            `${backendBaseUrl}/external-api${simulateQuery}`,
            {
              method: 'GET',
              headers: {
                Authorization: `Bearer ${activeToken}`,
              },
            },
            {
              regions,
              maxRetries: config.autoHeal ? 2 : 0,
              tokenRefresher: async ({ previousToken }) => {
                const rotated = await refreshToken(previousToken);
                activeToken = rotated;
                setApiKey(rotated);
                return rotated;
              },
              logger: () => {},
            },
          );

          setSmartFetchRequests((prev) => [
            { ...result, requestedAt: new Date().toISOString() },
            ...prev,
          ].slice(0, 5));
        }
      } catch (error) {
        setSimulationError(
          error instanceof Error ? error.message : 'Simulation failed',
        );
      } finally {
        setIsSimulating(false);
      }
    },
    [apiKey],
  );

  const endpointHealth = useMemo(
    () => deriveEndpointHealth(healingResult, backendBaseUrl),
    [healingResult],
  );
  const healingLogs = useMemo(
    () => deriveHealingLogs(healingResult),
    [healingResult],
  );
  const recoveryQueue = useMemo(
    () => deriveRecoveryQueue(healingResult),
    [healingResult],
  );
  const credentialPool = useMemo(
    () => deriveCredentialPool(apiKey, smartFetchRequests, healingResult),
    [apiKey, smartFetchRequests, healingResult],
  );
  const quotaUsage = useMemo(
    () => deriveQuotaUsage(smartFetchRequests, healingResult),
    [smartFetchRequests, healingResult],
  );
  const liveEvents = useMemo(
    () => deriveLiveEvents(smartFetchRequests, healingResult),
    [smartFetchRequests, healingResult],
  );

  return (
    <div className="flex min-h-screen flex-col bg-[#fafbfc] text-[#24292f]">
      <header className="sticky top-0 z-40 border-b border-[#d0d7de] bg-white">
        <div className="mx-auto flex h-16 max-w-[1600px] items-center justify-between px-6">
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            <div>
              <p className="text-sm font-semibold">API Battle Healer Hub</p>
              <p className="text-xs text-[#57606a]">
                Gemini-assisted resilience across flaky regions
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 rounded-md border border-[#2da44e]/30 bg-[#dafbe1] px-3 py-1">
              <span className="h-2 w-2 rounded-full bg-[#2da44e]" />
              <span className="text-xs font-medium text-[#1a7f37]">
                Backend healthy
              </span>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-8 border-[#d0d7de] text-xs text-[#24292f]"
              onClick={() => window.location.reload()}
            >
              <RefreshCw className="mr-2 h-3.5 w-3.5" />
              Refresh
            </Button>
          </div>
        </div>
        <div className="mx-auto flex max-w-[1600px] gap-6 px-6">
          {scenarioTabs.map(({ id, label, icon: Icon }) => {
            const isActive = activeTab === id;
            return (
              <button
                key={id}
                onClick={() => setActiveTab(id)}
                className={`flex items-center gap-2 border-b-2 px-1 py-3 text-sm font-medium ${
                  isActive
                    ? 'border-[#fd8c73] text-[#24292f]'
                    : 'border-transparent text-[#57606a] hover:border-[#d0d7de] hover:text-[#24292f]'
                }`}
                type="button"
              >
                <Icon className="h-4 w-4" />
                {label}
              </button>
            );
          })}
        </div>
      </header>

      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[1600px] px-6 py-8">
          {activeTab === 'overview' && (
            <div className="space-y-6">
              <div className="grid gap-6 lg:grid-cols-3">
                <div className="space-y-6 lg:col-span-2">
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="rounded-md border border-[#d0d7de] bg-white p-5">
                      <div className="mb-3 flex items-center gap-2">
                        <Key className="h-4 w-4 text-[#0969da]" />
                        <h3 className="text-sm font-semibold">
                          Generate demo API key
                        </h3>
                      </div>
                      <p className="text-sm text-[#57606a]">
                        Keys drive the FastAPI backend. Rotate anytime without
                        touching the backend.
                      </p>
                      <div className="mt-4 flex flex-col gap-3">
                        <Button
                          onClick={handleGenerateKey}
                          disabled={keyLoading}
                          className="bg-[#1a7f37] text-white hover:bg-[#1f8a3f]"
                        >
                          {keyLoading ? 'Issuing…' : 'Issue key'}
                        </Button>
                        {keyError && (
                          <p className="text-sm text-red-600">{keyError}</p>
                        )}
                        {apiKey && (
                          <code className="block rounded-md bg-[#f6f8fa] px-3 py-2 text-xs text-[#24292f]">
                            {apiKey}
                          </code>
                        )}
                      </div>
                    </div>
                    <div className="rounded-md border border-[#d0d7de] bg-white p-5">
                      <div className="mb-3 flex items-center gap-2">
                        <Sparkles className="h-4 w-4 text-[#9a6700]" />
                        <h3 className="text-sm font-semibold">
                          Run Gemini healing plan
                        </h3>
                      </div>
                      <div className="space-y-3">
                        <label className="text-xs font-medium text-[#57606a]">
                          Failure recipe
                          <select
                            className="mt-1 w-full rounded-md border border-[#d0d7de] px-2 py-1 text-sm"
                            value={healingScenario}
                            onChange={(event) =>
                              setHealingScenario(event.target.value)
                            }
                          >
                            {healingScenarioOptions.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <Button
                          onClick={handleRunHealingAgent}
                          disabled={healingLoading}
                          className="w-full bg-[#cf222e] text-white hover:bg-[#b91f2a]"
                        >
                          {healingLoading ? 'Healing…' : 'Run self-healer'}
                        </Button>
                        {healingError && (
                          <p className="text-sm text-red-600">{healingError}</p>
                        )}
                      </div>
                    </div>
                  </div>

                  <EndpointMap endpoints={endpointHealth} />
                  <QuotaGauge quotaData={quotaUsage} />
                </div>
                <div className="space-y-6">
                  <LiveActivityFeed events={liveEvents} maxItems={8} />
                  <HealingTimeline logs={healingLogs} />
                </div>
              </div>
            </div>
          )}

          {activeTab === 'recovery' && (
            <div className="grid gap-6 lg:grid-cols-2">
              <HealingTimeline logs={healingLogs} />
              <RecoveryQueuePanel
                queue={recoveryQueue}
                onRetry={(item) =>
                  setSimulationError(`Retry scheduled for ${item.endpoint}`)
                }
                onRemove={(item) =>
                  setSimulationError(`Removed ${item.endpoint} from queue`)
                }
              />
              <SmartFetchMonitor requests={smartFetchRequests} />
            </div>
          )}

          {activeTab === 'credentials' && (
            <div className="grid gap-6 lg:grid-cols-2">
              <CredentialRotator
                credentials={credentialPool}
                onRotate={handleRotateCredentials}
              />
              <QuotaGauge quotaData={quotaUsage} />
            </div>
          )}

          {activeTab === 'simulation' && (
            <div className="space-y-6">
              <div className="grid gap-6 lg:grid-cols-2">
                <SimulationPanel
                  onRunSimulation={({ scenario, autoHeal }) =>
                    runSmartFetchScenario({ scenario, autoHeal })
                  }
                  isRunning={isSimulating}
                />
                <SmartFetchMonitor requests={smartFetchRequests} />
              </div>
              {simulationError && (
                <div className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  <AlertTriangle className="h-4 w-4" />
                  {simulationError}
                </div>
              )}
              <div className="grid gap-6 lg:grid-cols-2">
                <LiveActivityFeed events={liveEvents} maxItems={10} />
                <RecoveryQueuePanel
                  queue={recoveryQueue}
                  onRetryAll={() =>
                    setSimulationError('Bulk retry triggered from simulation')
                  }
                  onRetry={(item) =>
                    setSimulationError(`Retry triggered for ${item.endpoint}`)
                  }
                  onRemove={() => {}}
                />
              </div>
            </div>
          )}
        </div>
      </main>

      <footer className="border-t border-[#d0d7de] bg-white">
        <div className="mx-auto flex max-w-[1600px] items-center justify-between px-6 py-3 text-xs text-[#57606a]">
          <span>FastAPI backend at {backendBaseUrl}</span>
          <span className="flex items-center gap-2">
            <Globe className="h-3 w-3" />
            Region simulator · smartFetch retries · Gemini planner
          </span>
        </div>
      </footer>
    </div>
  );
}
