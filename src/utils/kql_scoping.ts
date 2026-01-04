import { KueryNode, getKqlFieldNames, nodeBuilder, nodeTypes } from '../../libs/es-query/src/kuery';

export const LOCATION_FIELDS = new Set([
  'filePath',
  'directoryPath',
  'directoryName',
  'directoryDepth',
  'git_branch',
  'git_file_hash',
  'startLine',
  'endLine',
  'chunk_id',
]);

function classifyNode(node: KueryNode): 'chunk' | 'location' | 'mixed' {
  const fields = getKqlFieldNames(node);
  const hasLocation = fields.some((f: string) => LOCATION_FIELDS.has(f));
  const hasChunk = fields.some((f: string) => !LOCATION_FIELDS.has(f));

  if (hasLocation && hasChunk) return 'mixed';
  if (hasLocation) return 'location';
  return 'chunk';
}

export function splitKqlNodeByStorage(node: KueryNode): {
  chunkNode?: KueryNode;
  locationNode?: KueryNode;
  hasMixed: boolean;
} {
  const classification = classifyNode(node);
  if (classification === 'chunk') {
    return { chunkNode: node, hasMixed: false };
  }
  if (classification === 'location') {
    return { locationNode: node, hasMixed: false };
  }

  // Mixed: try to split `and(...)` safely; otherwise keep as location-only (to avoid ES errors).
  if (nodeTypes.function.isNode(node) && node.function === 'and') {
    const chunkChildren: KueryNode[] = [];
    const locationChildren: KueryNode[] = [];
    let hasMixed = false;

    for (const child of node.arguments as KueryNode[]) {
      const split = splitKqlNodeByStorage(child);
      if (split.chunkNode) chunkChildren.push(split.chunkNode);
      if (split.locationNode) locationChildren.push(split.locationNode);
      if (split.hasMixed) hasMixed = true;
      // Defensive: today splitKqlNodeByStorage always returns at least one node, but keep this guard
      // in case the KQL AST shape changes or we add new node types.
      if (!split.chunkNode && !split.locationNode) hasMixed = true;
    }

    return {
      chunkNode: chunkChildren.length > 0 ? nodeBuilder.and(chunkChildren) : undefined,
      locationNode: locationChildren.length > 0 ? nodeBuilder.and(locationChildren) : undefined,
      hasMixed,
    };
  }

  return { locationNode: node, hasMixed: true };
}
