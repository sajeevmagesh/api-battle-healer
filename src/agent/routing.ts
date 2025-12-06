import { ROUTING_TREE, RegionNode, flattenRoutingTree } from '../config/routing';

export type RegionHealthState = Record<string, 'healthy' | 'unhealthy' | 'deprecated'>;

const FLATTENED = flattenRoutingTree(ROUTING_TREE);
const REGION_MAP = new Map(FLATTENED.map((node) => [node.id, node]));

export function resolveNextRegion(
  currentRegionId: string | undefined,
  health: RegionHealthState = {},
  options: { forceInclude?: string[] } = {},
): RegionNode | undefined {
  const visited = new Set<string>();
  const forceInclude = new Set(options.forceInclude ?? []);

  const currentNode =
    (currentRegionId && REGION_MAP.get(currentRegionId)) || ROUTING_TREE.children?.[0];

  if (!currentNode) {
    return undefined;
  }

  const queue: string[] = [];
  const addCandidates = (node: RegionNode) => {
    node.children?.forEach((child) => {
      if (!visited.has(child.id)) {
        queue.push(child.id);
      }
    });
    node.fallbacks?.forEach((id) => {
      if (!visited.has(id)) {
        queue.push(id);
      }
    });
  };

  addCandidates(currentNode);
  if (queue.length === 0 && ROUTING_TREE.children) {
    ROUTING_TREE.children.forEach((child) => {
      if (!visited.has(child.id)) {
        queue.push(child.id);
      }
    });
  }

  while (queue.length) {
    const nextId = queue.shift()!;
    visited.add(nextId);
    const candidate = REGION_MAP.get(nextId);
    if (!candidate) {
      continue;
    }
    const status = health[candidate.id] || 'healthy';
    if (status !== 'healthy' && !forceInclude.has(candidate.id)) {
      continue;
    }
    return candidate;
  }

  const first = ROUTING_TREE.children?.[0];
  if (first) {
    return first;
  }
  return undefined;
}
