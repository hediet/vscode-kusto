import { describe, it, expect } from 'vitest';
import { SourceMap, SourceSegment } from './sourceMap';
import { OffsetRange } from './offsetRange';
import { DocumentOffset } from './documentOffset';

describe('SourceMap', () => {
	describe('constructor validation', () => {
		it('accepts empty segments', () => {
			const map = new SourceMap([]);
			expect(map.segments.length).toMatchInlineSnapshot(`0`);
		});

		it('accepts single segment', () => {
			const map = new SourceMap([
				new SourceSegment(new OffsetRange(0, 10), 'file://a.kql', new OffsetRange(0, 10))
			]);
			expect(map.segments.length).toMatchInlineSnapshot(`1`);
		});

		it('accepts properly sorted non-overlapping segments', () => {
			const map = new SourceMap([
				new SourceSegment(new OffsetRange(0, 10), 'file://a.kql', new OffsetRange(0, 10)),
				new SourceSegment(new OffsetRange(15, 25), 'file://b.kql', new OffsetRange(5, 15)),
			]);
			expect(map.segments.length).toMatchInlineSnapshot(`2`);
		});

		it('accepts adjacent segments (no gap)', () => {
			const map = new SourceMap([
				new SourceSegment(new OffsetRange(0, 10), 'file://a.kql', new OffsetRange(0, 10)),
				new SourceSegment(new OffsetRange(10, 20), 'file://b.kql', new OffsetRange(0, 10)),
			]);
			expect(map.segments.length).toMatchInlineSnapshot(`2`);
		});

		it('throws for overlapping segments', () => {
			expect(() => new SourceMap([
				new SourceSegment(new OffsetRange(0, 15), 'file://a.kql', new OffsetRange(0, 15)),
				new SourceSegment(new OffsetRange(10, 20), 'file://b.kql', new OffsetRange(0, 10)),
			])).toThrowErrorMatchingInlineSnapshot(
				`[Error: SourceMap segments must be sorted and non-overlapping. Segment 0 ends at 15, but segment 1 starts at 10.]`
			);
		});

		it('throws for unsorted segments', () => {
			expect(() => new SourceMap([
				new SourceSegment(new OffsetRange(20, 30), 'file://a.kql', new OffsetRange(0, 10)),
				new SourceSegment(new OffsetRange(5, 15), 'file://b.kql', new OffsetRange(0, 10)),
			])).toThrowErrorMatchingInlineSnapshot(
				`[Error: SourceMap segments must be sorted and non-overlapping. Segment 0 ends at 30, but segment 1 starts at 5.]`
			);
		});
	});

	describe('toDocumentOffset', () => {
		const map = new SourceMap([
			// Virtual [0, 20) -> file://a.kql [10, 30)
			new SourceSegment(new OffsetRange(0, 20), 'file://a.kql', new OffsetRange(10, 30)),
			// Virtual [25, 45) -> file://b.kql [0, 20)
			new SourceSegment(new OffsetRange(25, 45), 'file://b.kql', new OffsetRange(0, 20)),
		]);

		it('maps offset in first segment', () => {
			expect(map.toDocumentOffset(5)).toMatchInlineSnapshot(`
				DocumentOffset {
				  "offset": 15,
				  "uri": "file://a.kql",
				}
			`);
		});

		it('maps offset at start of first segment', () => {
			expect(map.toDocumentOffset(0)).toMatchInlineSnapshot(`
				DocumentOffset {
				  "offset": 10,
				  "uri": "file://a.kql",
				}
			`);
		});

		it('maps offset in second segment', () => {
			expect(map.toDocumentOffset(30)).toMatchInlineSnapshot(`
				DocumentOffset {
				  "offset": 5,
				  "uri": "file://b.kql",
				}
			`);
		});

		it('returns undefined for offset in gap between segments', () => {
			expect(map.toDocumentOffset(22)).toMatchInlineSnapshot(`undefined`);
		});

		it('returns undefined for offset before all segments', () => {
			const mapWithGap = new SourceMap([
				new SourceSegment(new OffsetRange(10, 20), 'file://a.kql', new OffsetRange(0, 10)),
			]);
			expect(mapWithGap.toDocumentOffset(5)).toMatchInlineSnapshot(`undefined`);
		});

		it('returns undefined for offset after all segments', () => {
			expect(map.toDocumentOffset(100)).toMatchInlineSnapshot(`undefined`);
		});

		it('returns undefined for offset at exclusive end of segment', () => {
			// 20 is endExclusive of first segment, not contained
			expect(map.toDocumentOffset(20)).toMatchInlineSnapshot(`undefined`);
		});
	});

	describe('fromDocumentOffset', () => {
		const map = new SourceMap([
			// Virtual [0, 20) -> file://a.kql [10, 30)
			new SourceSegment(new OffsetRange(0, 20), 'file://a.kql', new OffsetRange(10, 30)),
			// Virtual [25, 45) -> file://b.kql [0, 20)
			new SourceSegment(new OffsetRange(25, 45), 'file://b.kql', new OffsetRange(0, 20)),
		]);

		it('maps document offset from first segment', () => {
			expect(map.fromDocumentOffset(new DocumentOffset('file://a.kql', 15))).toMatchInlineSnapshot(`5`);
		});

		it('maps document offset from second segment', () => {
			expect(map.fromDocumentOffset(new DocumentOffset('file://b.kql', 5))).toMatchInlineSnapshot(`30`);
		});

		it('returns undefined for unknown uri', () => {
			expect(map.fromDocumentOffset(new DocumentOffset('file://unknown.kql', 5))).toMatchInlineSnapshot(`undefined`);
		});

		it('returns undefined for offset outside mapped range', () => {
			// file://a.kql is mapped from [10, 30), so offset 5 is outside
			expect(map.fromDocumentOffset(new DocumentOffset('file://a.kql', 5))).toMatchInlineSnapshot(`undefined`);
		});

		it('maps offset at start of segment (inclusive)', () => {
			// file://a.kql sourceRange starts at 10
			expect(map.fromDocumentOffset(new DocumentOffset('file://a.kql', 10))).toMatchInlineSnapshot(`0`);
		});

		it('returns undefined for offset at end of segment by default', () => {
			// file://a.kql sourceRange ends at 30 (exclusive)
			// By default, endExclusive is not included
			expect(map.fromDocumentOffset(new DocumentOffset('file://a.kql', 30))).toMatchInlineSnapshot(`undefined`);
		});

		it('maps offset at end of segment with includeTouchingEnd=true', () => {
			// file://a.kql sourceRange ends at 30 (exclusive), but with includeTouchingEnd we include it
			// This handles completions at end of line/document
			expect(map.fromDocumentOffset(new DocumentOffset('file://a.kql', 30), true)).toMatchInlineSnapshot(`20`);
		});

		it('returns undefined for offset past end of segment', () => {
			// file://a.kql is mapped from [10, 30), offset 31 is past the end
			expect(map.fromDocumentOffset(new DocumentOffset('file://a.kql', 31))).toMatchInlineSnapshot(`undefined`);
		});

		it('returns undefined for offset past end even with includeTouchingEnd', () => {
			// offset 31 is past the end, even with includeTouchingEnd
			expect(map.fromDocumentOffset(new DocumentOffset('file://a.kql', 31), true)).toMatchInlineSnapshot(`undefined`);
		});
	});

	describe('bidirectional mapping consistency', () => {
		const map = new SourceMap([
			new SourceSegment(new OffsetRange(0, 50), 'file://main.kql', new OffsetRange(100, 150)),
		]);

		it('toDocumentOffset then fromDocumentOffset returns original', () => {
			const virtualOffset = 25;
			const docOffset = map.toDocumentOffset(virtualOffset);
			expect(docOffset).not.toBeUndefined();
			expect(map.fromDocumentOffset(docOffset!)).toMatchInlineSnapshot(`25`);
		});

		it('fromDocumentOffset then toDocumentOffset returns original', () => {
			const docOffset = new DocumentOffset('file://main.kql', 125);
			const virtualOffset = map.fromDocumentOffset(docOffset);
			expect(virtualOffset).not.toBeUndefined();
			expect(map.toDocumentOffset(virtualOffset!)).toMatchInlineSnapshot(`
				DocumentOffset {
				  "offset": 125,
				  "uri": "file://main.kql",
				}
			`);
		});
	});
});
