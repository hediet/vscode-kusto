import { OffsetRange } from './offsetRange';
import { SourceMap, SourceSegment } from './sourceMap';

/** Range in a specific document. */
export class DocumentRange {
	constructor(
		public readonly uri: string,
		public readonly range: OffsetRange
	) {}
}

/**
 * Builds a string and its corresponding SourceMap incrementally.
 * Automatically merges adjacent segments from the same source.
 */
export class SourceMapBuilder {
	private _text = '';
	private readonly _segments: SourceSegment[] = [];

	get length(): number {
		return this._text.length;
	}

	/** Adjacent appends from the same source are merged into a single segment. */
	append(value: string, source?: DocumentRange): this {
		if (value.length === 0) {
			return this;
		}

		const virtualStart = this._text.length;
		this._text += value;
		const virtualEnd = this._text.length;

		if (source) {
			const virtualRange = new OffsetRange(virtualStart, virtualEnd);
			const lastSegment = this._segments[this._segments.length - 1];

			// Try to merge with previous segment if same source and adjacent
			if (lastSegment &&
				lastSegment.sourceUri === source.uri &&
				lastSegment.virtualRange.endExclusive === virtualStart &&
				lastSegment.sourceRange.endExclusive === source.range.start) {
				// Replace last segment with merged one
				this._segments[this._segments.length - 1] = new SourceSegment(
					new OffsetRange(lastSegment.virtualRange.start, virtualEnd),
					source.uri,
					new OffsetRange(lastSegment.sourceRange.start, source.range.endExclusive)
				);
			} else {
				this._segments.push(new SourceSegment(virtualRange, source.uri, source.range));
			}
		}

		return this;
	}

	build(): { text: string; sourceMap: SourceMap } {
		return {
			text: this._text,
			sourceMap: new SourceMap(this._segments),
		};
	}
}
