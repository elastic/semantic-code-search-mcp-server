import { QueryDslQueryContainer } from '@elastic/elasticsearch/lib/api/types';
import { fromKueryExpression, toElasticsearchQuery } from '../../libs/es-query';
import { KueryNode, getKqlFieldNames, nodeTypes } from '../../libs/es-query/src/kuery';
import { client, getLocationsIndexName } from './elasticsearch';
import { LOCATION_FIELDS } from './kql_scoping';

function isLocationField(field: string): boolean {
  return LOCATION_FIELDS.has(field);
}

function union(a: Set<string>, b: Set<string>): Set<string> {
  if (a.size === 0) return new Set(b);
  const out = new Set(a);
  for (const v of b) out.add(v);
  return out;
}

function intersect(a: Set<string>, b: Set<string>): Set<string> {
  if (a.size === 0 || b.size === 0) return new Set();
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  const out = new Set<string>();
  for (const v of small) {
    if (big.has(v)) out.add(v);
  }
  return out;
}

function difference(universe: Set<string>, remove: Set<string>): Set<string> {
  if (universe.size === 0) return new Set();
  if (remove.size === 0) return new Set(universe);
  const out = new Set<string>();
  for (const v of universe) {
    if (!remove.has(v)) out.add(v);
  }
  return out;
}

const CHUNK_ID_BATCH_SIZE = 1000;

function batchArray<T>(items: T[], batchSize: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    out.push(items.slice(i, i + batchSize));
  }
  return out;
}

function classifyLeafNode(node: KueryNode): 'chunk' | 'location' | 'unsupported_mixed' {
  const fields = getKqlFieldNames(node);
  const hasLocation = fields.some((f: string) => isLocationField(f));
  const hasChunk = fields.some((f: string) => !isLocationField(f));

  if (hasLocation && hasChunk) return 'unsupported_mixed';
  if (hasLocation) return 'location';
  return 'chunk';
}

async function matchChunkPredicateInUniverse(
  dsl: QueryDslQueryContainer,
  universeChunkIds: string[],
  baseIndex: string
): Promise<Set<string>> {
  const matched = new Set<string>();
  for (const batch of batchArray(universeChunkIds, CHUNK_ID_BATCH_SIZE)) {
    const response = await client.search({
      index: baseIndex,
      query: {
        bool: {
          must: [dsl, { ids: { values: batch } }],
        },
      },
      _source: false,
      // We expect at most batch.length hits because the ids clause limits the set.
      // Using size=batch.length avoids pagination while keeping the request bounded.
      size: batch.length,
    });

    for (const hit of response.hits.hits) {
      if (typeof hit._id === 'string' && hit._id.length > 0) {
        matched.add(hit._id);
      }
    }
  }
  return matched;
}

async function matchLocationPredicateInUniverse(
  dsl: QueryDslQueryContainer,
  universeChunkIds: string[],
  baseIndex: string
): Promise<Set<string>> {
  const matched = new Set<string>();
  const locationsIndex = getLocationsIndexName(baseIndex);

  for (const batch of batchArray(universeChunkIds, CHUNK_ID_BATCH_SIZE)) {
    const response = await client.search({
      index: locationsIndex,
      query: {
        bool: {
          must: [dsl, { terms: { chunk_id: batch } }],
        },
      },
      size: 0,
      aggs: {
        present: {
          terms: {
            field: 'chunk_id',
            size: batch.length,
          },
        },
      },
    });

    const buckets = (response.aggregations as unknown as { present?: { buckets?: Array<{ key?: unknown }> } })?.present
      ?.buckets;
    for (const b of buckets ?? []) {
      if (typeof b.key === 'string') {
        matched.add(b.key);
      }
    }
  }

  return matched;
}

async function evalNode(node: KueryNode, universe: Set<string>, baseIndex: string): Promise<Set<string>> {
  if (nodeTypes.function.isNode(node)) {
    if (node.function === 'and') {
      const children = node.arguments as KueryNode[];
      let acc = new Set(universe);
      for (const child of children) {
        acc = intersect(acc, await evalNode(child, universe, baseIndex));
        if (acc.size === 0) break;
      }
      return acc;
    }

    if (node.function === 'or') {
      const children = node.arguments as KueryNode[];
      let acc = new Set<string>();
      for (const child of children) {
        acc = union(acc, await evalNode(child, universe, baseIndex));
      }
      return acc;
    }

    if (node.function === 'not') {
      const [child] = node.arguments as KueryNode[];
      if (!child) return new Set();
      const childSet = await evalNode(child, universe, baseIndex);
      return difference(universe, childSet);
    }
  }

  // Leaf predicate: resolve by querying the correct index, but always restrict to the universe ids.
  const universeIds = Array.from(universe);
  if (universeIds.length === 0) return new Set();

  const leafType = classifyLeafNode(node);
  if (leafType === 'unsupported_mixed') {
    const fields = Array.from(new Set((getKqlFieldNames(node) ?? []) as string[]));
    const locationFields = fields.filter((f) => isLocationField(f));
    const chunkFields = fields.filter((f) => !isLocationField(f));

    throw new Error(
      'Unsupported KQL expression: a single clause references both chunk fields and location fields. ' +
        `Chunk fields: [${chunkFields.join(', ') || '<none>'}]. ` +
        `Location fields: [${locationFields.join(', ') || '<none>'}]. ` +
        'Please rewrite as separate clauses (e.g. (chunk_field:...) AND (location_field:...)) so it can be evaluated across <alias> and <alias>_locations.'
    );
  }

  const dsl = toElasticsearchQuery(node);
  return leafType === 'location'
    ? await matchLocationPredicateInUniverse(dsl, universeIds, baseIndex)
    : await matchChunkPredicateInUniverse(dsl, universeIds, baseIndex);
}

export async function filterChunkIdsByKqlWithinUniverse(options: {
  kql: string;
  baseIndex: string;
  universeChunkIds: string[];
}): Promise<Set<string>> {
  const universe = new Set(options.universeChunkIds.filter((id) => typeof id === 'string' && id.length > 0));
  if (universe.size === 0) return new Set();

  const ast = fromKueryExpression(options.kql) as unknown as KueryNode;
  return await evalNode(ast, universe, options.baseIndex);
}
