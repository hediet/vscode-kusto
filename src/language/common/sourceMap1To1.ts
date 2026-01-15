import { OffsetRange } from './offsetRange';

/**
 * A simple 1:1 source map where positions differ by a fixed offset.
 * Useful when embedding source content at a known position in a virtual document.
 */
export class SourceMap1To1 {
    constructor(
        /** The range in the source document. */
        public readonly sourceRange: OffsetRange,
        /** The offset in the target document where source content starts. */
        public readonly targetOffset: number
    ) { }

    /** The delta to add to source offset to get target offset. */
    get delta(): number {
        return this.targetOffset - this.sourceRange.start;
    }

    /** Map source offset → target offset. Returns undefined if outside source range. */
    toTarget(sourceOffset: number): number | undefined {
        if (!this.sourceRange.contains(sourceOffset)) return undefined;
        return sourceOffset + this.delta;
    }

    /** Map target offset → source offset. Returns undefined if outside mapped range. */
    toSource(targetOffset: number): number | undefined {
        const sourceOffset = targetOffset - this.delta;
        if (!this.sourceRange.contains(sourceOffset)) return undefined;
        return sourceOffset;
    }
}
