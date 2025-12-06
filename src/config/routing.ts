export type RegionNode = {
  id: string;
  label: string;
  provider: string;
  endpoint: string;
  weight?: number;
  children?: RegionNode[];
  fallbacks?: string[];
};

export const ROUTING_TREE: RegionNode = {
  id: 'default',
  label: 'Battle Healer Default',
  provider: 'battle-healer',
  endpoint: 'http://localhost:8000',
  children: [
    {
      id: 'aws-us-east-1',
      label: 'AWS us-east-1',
      provider: 'aws',
      endpoint: 'http://localhost:8000/regions/us-east-1',
      fallbacks: ['aws-eu-west-1', 'openai-us'],
    },
    {
      id: 'aws-eu-west-1',
      label: 'AWS eu-west-1 (deprecated demo)',
      provider: 'aws',
      endpoint: 'http://localhost:8000/regions/deprecated-eu',
      fallbacks: ['openai-us'],
    },
    {
      id: 'openai-us',
      label: 'OpenAI proxy',
      provider: 'openai',
      endpoint: 'http://localhost:8000/regions/openai-us',
      fallbacks: ['anthropic-us'],
    },
    {
      id: 'anthropic-us',
      label: 'Anthropic proxy',
      provider: 'anthropic',
      endpoint: 'http://localhost:8000/regions/anthropic-us',
    },
  ],
};

export function flattenRoutingTree(node: RegionNode, acc: RegionNode[] = []): RegionNode[] {
  acc.push(node);
  node.children?.forEach((child) => flattenRoutingTree(child, acc));
  return acc;
}

const FLATTENED = flattenRoutingTree(ROUTING_TREE);
const REGION_BY_ID = new Map(FLATTENED.map((node) => [node.id, node]));
const REGION_BY_ENDPOINT = new Map(
  FLATTENED.map((node) => [node.endpoint.toLowerCase(), node]),
);

export function findRegionById(id: string): RegionNode | undefined {
  return REGION_BY_ID.get(id);
}

export function findRegionByEndpoint(endpoint: string): RegionNode | undefined {
  return REGION_BY_ENDPOINT.get(endpoint.toLowerCase());
}
