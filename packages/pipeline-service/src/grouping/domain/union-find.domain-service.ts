import { ScanResultMatch } from '@gunea-pig/shared';

export class UnionFindDomainService {
  buildConnectedComponents(
    edges: ScanResultMatch[],
    allVideoIds: string[],
  ): Set<string>[] {
    const parent = new Map<string, string>();

    const find = (id: string): string => {
      if (!parent.has(id)) parent.set(id, id);
      if (parent.get(id) !== id) parent.set(id, find(parent.get(id)!));
      return parent.get(id)!;
    };

    const union = (a: string, b: string): void => {
      parent.set(find(a), find(b));
    };

    for (const id of allVideoIds) find(id);
    for (const { videoIdA, videoIdB } of edges) union(videoIdA, videoIdB);

    const groups = new Map<string, Set<string>>();
    for (const id of allVideoIds) {
      const root = find(id);
      if (!groups.has(root)) groups.set(root, new Set());
      groups.get(root)!.add(id);
    }

    return [...groups.values()];
  }
}
