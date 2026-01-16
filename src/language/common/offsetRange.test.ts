import { describe, it, expect } from 'vitest';
import { OffsetRange } from './offsetRange';

describe('OffsetRange', () => {
	describe('constructor', () => {
		it('creates a valid range', () => {
			const range = new OffsetRange(5, 10);
			expect(range.toString()).toMatchInlineSnapshot(`"[5, 10)"`);
		});

		it('throws when start > endExclusive', () => {
			expect(() => new OffsetRange(10, 5)).toThrowErrorMatchingInlineSnapshot(
				`[Error: Invalid OffsetRange: start (10) > endExclusive (5)]`
			);
		});

		it('allows empty range', () => {
			const range = new OffsetRange(5, 5);
			expect(range.toString()).toMatchInlineSnapshot(`"[5, 5)"`);
		});
	});

	describe('static factories', () => {
		it('empty creates zero-length range', () => {
			expect(OffsetRange.empty(7).toString()).toMatchInlineSnapshot(`"[7, 7)"`);
		});

		it('ofLength creates range with given length', () => {
			expect(OffsetRange.ofLength(3, 5).toString()).toMatchInlineSnapshot(`"[3, 8)"`);
		});
	});

	describe('properties', () => {
		it('length returns correct value', () => {
			expect(new OffsetRange(5, 15).length).toMatchInlineSnapshot(`10`);
		});

		it('isEmpty is true for empty range', () => {
			expect(new OffsetRange(5, 5).isEmpty).toMatchInlineSnapshot(`true`);
		});

		it('isEmpty is false for non-empty range', () => {
			expect(new OffsetRange(5, 10).isEmpty).toMatchInlineSnapshot(`false`);
		});
	});

	describe('contains', () => {
		it('returns true for offset within range', () => {
			expect(new OffsetRange(5, 10).contains(7)).toMatchInlineSnapshot(`true`);
		});

		it('returns true for start offset', () => {
			expect(new OffsetRange(5, 10).contains(5)).toMatchInlineSnapshot(`true`);
		});

		it('returns false for end offset (exclusive)', () => {
			expect(new OffsetRange(5, 10).contains(10)).toMatchInlineSnapshot(`false`);
		});

		it('returns false for offset before range', () => {
			expect(new OffsetRange(5, 10).contains(3)).toMatchInlineSnapshot(`false`);
		});
	});

	describe('containsOrTouches', () => {
		it('returns true for offset within range', () => {
			expect(new OffsetRange(5, 10).containsOrTouches(7)).toMatchInlineSnapshot(`true`);
		});

		it('returns true for start offset', () => {
			expect(new OffsetRange(5, 10).containsOrTouches(5)).toMatchInlineSnapshot(`true`);
		});

		it('returns true for end offset (inclusive)', () => {
			expect(new OffsetRange(5, 10).containsOrTouches(10)).toMatchInlineSnapshot(`true`);
		});

		it('returns false for offset before range', () => {
			expect(new OffsetRange(5, 10).containsOrTouches(3)).toMatchInlineSnapshot(`false`);
		});

		it('returns false for offset after range', () => {
			expect(new OffsetRange(5, 10).containsOrTouches(11)).toMatchInlineSnapshot(`false`);
		});
	});

	describe('containsRange', () => {
		it('returns true when other is fully contained', () => {
			expect(new OffsetRange(0, 10).containsRange(new OffsetRange(2, 8))).toMatchInlineSnapshot(`true`);
		});

		it('returns true for same range', () => {
			expect(new OffsetRange(5, 10).containsRange(new OffsetRange(5, 10))).toMatchInlineSnapshot(`true`);
		});

		it('returns false when other starts before', () => {
			expect(new OffsetRange(5, 10).containsRange(new OffsetRange(3, 8))).toMatchInlineSnapshot(`false`);
		});
	});

	describe('intersects', () => {
		it('returns true for overlapping ranges', () => {
			expect(new OffsetRange(0, 10).intersects(new OffsetRange(5, 15))).toMatchInlineSnapshot(`true`);
		});

		it('returns false for adjacent ranges', () => {
			expect(new OffsetRange(0, 5).intersects(new OffsetRange(5, 10))).toMatchInlineSnapshot(`false`);
		});

		it('returns false for disjoint ranges', () => {
			expect(new OffsetRange(0, 5).intersects(new OffsetRange(10, 15))).toMatchInlineSnapshot(`false`);
		});
	});

	describe('intersect', () => {
		it('returns intersection of overlapping ranges', () => {
			expect(new OffsetRange(0, 10).intersect(new OffsetRange(5, 15))?.toString()).toMatchInlineSnapshot(`"[5, 10)"`);
		});

		it('returns undefined for non-overlapping ranges', () => {
			expect(new OffsetRange(0, 5).intersect(new OffsetRange(10, 15))).toMatchInlineSnapshot(`undefined`);
		});
	});

	describe('join', () => {
		it('returns union of ranges', () => {
			expect(new OffsetRange(0, 5).join(new OffsetRange(10, 15)).toString()).toMatchInlineSnapshot(`"[0, 15)"`);
		});
	});

	describe('delta', () => {
		it('shifts range by positive delta', () => {
			expect(new OffsetRange(5, 10).delta(3).toString()).toMatchInlineSnapshot(`"[8, 13)"`);
		});

		it('shifts range by negative delta', () => {
			expect(new OffsetRange(5, 10).delta(-2).toString()).toMatchInlineSnapshot(`"[3, 8)"`);
		});
	});

	describe('substring', () => {
		it('extracts text within range', () => {
			expect(new OffsetRange(3, 7).substring('hello world')).toMatchInlineSnapshot(`"lo w"`);
		});
	});

	describe('equals', () => {
		it('returns true for equal ranges', () => {
			expect(new OffsetRange(5, 10).equals(new OffsetRange(5, 10))).toMatchInlineSnapshot(`true`);
		});

		it('returns false for different ranges', () => {
			expect(new OffsetRange(5, 10).equals(new OffsetRange(5, 11))).toMatchInlineSnapshot(`false`);
		});
	});
});
