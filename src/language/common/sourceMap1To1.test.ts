import { describe, it, expect } from 'vitest';
import { SourceMap1To1 } from './sourceMap1To1';
import { OffsetRange } from './offsetRange';

describe('SourceMap1To1', () => {
    it('maps source to target with positive delta', () => {
        // Source range [10, 20) mapped to target starting at 100
        const map = new SourceMap1To1(new OffsetRange(10, 20), 100);

        expect(map.delta).toBe(90);
        expect(map.toTarget(10)).toBe(100);
        expect(map.toTarget(15)).toBe(105);
        expect(map.toTarget(19)).toBe(109);
    });

    it('maps source to target with negative delta', () => {
        // Source range [100, 110) mapped to target starting at 10
        const map = new SourceMap1To1(new OffsetRange(100, 110), 10);

        expect(map.delta).toBe(-90);
        expect(map.toTarget(100)).toBe(10);
        expect(map.toTarget(105)).toBe(15);
    });

    it('returns undefined for source offset outside range', () => {
        const map = new SourceMap1To1(new OffsetRange(10, 20), 100);

        expect(map.toTarget(5)).toBeUndefined();
        expect(map.toTarget(20)).toBeUndefined();
        expect(map.toTarget(25)).toBeUndefined();
    });

    it('maps target to source', () => {
        const map = new SourceMap1To1(new OffsetRange(10, 20), 100);

        expect(map.toSource(100)).toBe(10);
        expect(map.toSource(105)).toBe(15);
        expect(map.toSource(109)).toBe(19);
    });

    it('returns undefined for target offset outside mapped range', () => {
        const map = new SourceMap1To1(new OffsetRange(10, 20), 100);

        expect(map.toSource(99)).toBeUndefined();
        expect(map.toSource(110)).toBeUndefined();
    });

    it('round-trips correctly', () => {
        const map = new SourceMap1To1(new OffsetRange(50, 75), 200);

        for (let src = 50; src < 75; src++) {
            const target = map.toTarget(src);
            expect(target).toBeDefined();
            expect(map.toSource(target!)).toBe(src);
        }
    });
});
