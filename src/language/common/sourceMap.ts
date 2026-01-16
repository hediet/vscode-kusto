import { DocumentOffset } from './documentOffset';
import { OffsetRange } from './offsetRange';

/**
 * A segment mapping a range in the virtual document to a range in a source document.
 */
export class SourceSegment {
	constructor(
		/** Range in the virtual document */
		public readonly virtualRange: OffsetRange,
		/** URI of the source document */
		public readonly sourceUri: string,
		/** Range in the source document */
		public readonly sourceRange: OffsetRange
	) { }
}

/**
 * Maps between virtual document offsets and physical document locations.
 * Segments must be sorted by virtualRange and non-overlapping.
 */
export class SourceMap {
	/**
	 * @param segments Must be sorted by virtualRange.start, non-overlapping
	 * @throws Error if segments are not sorted or overlap
	 */
	constructor(public readonly segments: readonly SourceSegment[]) {
		this._validateInvariant();
	}

	private _validateInvariant(): void {
		for (let i = 1; i < this.segments.length; i++) {
			const prev = this.segments[i - 1];
			const curr = this.segments[i];

			if (prev.virtualRange.endExclusive > curr.virtualRange.start) {
				throw new Error(
					`SourceMap segments must be sorted and non-overlapping. ` +
					`Segment ${i - 1} ends at ${prev.virtualRange.endExclusive}, ` +
					`but segment ${i} starts at ${curr.virtualRange.start}.`
				);
			}
		}
	}

	/**
	 * Maps a virtual document offset to a physical document location.
	 * Returns undefined if the offset is not within any segment.
	 */
	toDocumentOffset(virtualOffset: number): DocumentOffset | undefined {
		// Binary search for the segment containing the offset
		const segment = this._findSegmentContaining(virtualOffset);
		if (!segment) {
			return undefined;
		}

		const localOffset = virtualOffset - segment.virtualRange.start;
		return new DocumentOffset(segment.sourceUri, segment.sourceRange.start + localOffset);
	}

	/**
	 * Maps a physical document location to a virtual document offset.
	 * Returns undefined if the location is not within any segment.
	 * @param docOffset The document offset to map
	 * @param includeTouchingEnd If true, includes offsets at the exclusive end of segments (useful for cursor positions)
	 */
	fromDocumentOffset(docOffset: DocumentOffset, includeTouchingEnd: boolean = false): number | undefined {
		for (const segment of this.segments) {
			if (segment.sourceUri === docOffset.uri) {
				const inRange = includeTouchingEnd
					? segment.sourceRange.containsOrTouches(docOffset.offset)
					: segment.sourceRange.contains(docOffset.offset);
				if (inRange) {
					const localOffset = docOffset.offset - segment.sourceRange.start;
					return segment.virtualRange.start + localOffset;
				}
			}
		}
		return undefined;
	}

	private _findSegmentContaining(virtualOffset: number): SourceSegment | undefined {
		// Binary search since segments are sorted by virtualRange
		let low = 0;
		let high = this.segments.length - 1;

		while (low <= high) {
			const mid = Math.floor((low + high) / 2);
			const segment = this.segments[mid];

			if (segment.virtualRange.contains(virtualOffset)) {
				return segment;
			} else if (virtualOffset < segment.virtualRange.start) {
				high = mid - 1;
			} else {
				low = mid + 1;
			}
		}

		return undefined;
	}
}
