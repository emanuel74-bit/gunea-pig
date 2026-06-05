/**
 * TC-CHAR-035: Assert UnionFindDomainService.buildConnectedComponents() correctness
 * Additional characterization test
 */
import { UnionFindDomainService } from '../../src/grouping/domain/union-find.domain-service';
import { ScanResultMatch } from '@gunea-pig/shared';

describe('UnionFindDomainService.buildConnectedComponents() (TC-CHAR-035)', () => {
  let service: UnionFindDomainService;

  beforeEach(() => {
    service = new UnionFindDomainService();
  });

  it('two isolated videos with no match -> two components of size 1', () => {
    const components = service.buildConnectedComponents([], ['v1', 'v2']);
    expect(components).toHaveLength(2);
    for (const comp of components) {
      expect(comp.size).toBe(1);
    }
  });

  it('A-B match + B-C match -> one component {A, B, C}', () => {
    const edges: ScanResultMatch[] = [
      { videoIdA: 'A', videoIdB: 'B', score: 0.95 },
      { videoIdA: 'B', videoIdB: 'C', score: 0.96 },
    ];
    const components = service.buildConnectedComponents(edges, ['A', 'B', 'C']);
    expect(components).toHaveLength(1);
    expect(components[0].size).toBe(3);
    expect(components[0].has('A')).toBe(true);
    expect(components[0].has('B')).toBe(true);
    expect(components[0].has('C')).toBe(true);
  });

  it('A-B match + C-D match -> two components {A,B} and {C,D}', () => {
    const edges: ScanResultMatch[] = [
      { videoIdA: 'A', videoIdB: 'B', score: 0.95 },
      { videoIdA: 'C', videoIdB: 'D', score: 0.94 },
    ];
    const components = service.buildConnectedComponents(edges, ['A', 'B', 'C', 'D']);
    expect(components).toHaveLength(2);
    const sizes = components.map((c) => c.size).sort();
    expect(sizes).toEqual([2, 2]);
  });

  it('all videos in videoIds are represented in components (no video dropped)', () => {
    const edges: ScanResultMatch[] = [
      { videoIdA: 'v1', videoIdB: 'v2', score: 0.9 },
    ];
    const allVideos = ['v1', 'v2', 'v3', 'v4'];
    const components = service.buildConnectedComponents(edges, allVideos);
    const allInComponents = new Set<string>();
    for (const comp of components) {
      for (const id of comp) allInComponents.add(id);
    }
    for (const v of allVideos) {
      expect(allInComponents.has(v)).toBe(true);
    }
  });

  it('video with no edges appears in its own singleton component', () => {
    const edges: ScanResultMatch[] = [
      { videoIdA: 'v1', videoIdB: 'v2', score: 0.95 },
    ];
    const components = service.buildConnectedComponents(edges, ['v1', 'v2', 'v3']);
    const singleton = components.find((c) => c.size === 1 && c.has('v3'));
    expect(singleton).toBeDefined();
  });
});
