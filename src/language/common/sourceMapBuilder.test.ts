import { describe, it, expect } from 'vitest';
import { SourceMapBuilder, DocumentRange } from './sourceMapBuilder';
import { OffsetRange } from './offsetRange';

describe('SourceMapBuilder', () => {
	describe('append without source', () => {
		it('builds text without segments', () => {
			const builder = new SourceMapBuilder();
			builder.append('hello').append(' ').append('world');
			const { text, sourceMap } = builder.build();

			expect(text).toMatchInlineSnapshot(`"hello world"`);
			expect(sourceMap.segments.length).toMatchInlineSnapshot(`0`);
		});
	});

	describe('append with source', () => {
		it('builds single segment', () => {
			const builder = new SourceMapBuilder();
			builder.append('hello', new DocumentRange('file://a.kql', new OffsetRange(10, 15)));
			const { text, sourceMap } = builder.build();

			expect(text).toMatchInlineSnapshot(`"hello"`);
			expect(sourceMap.segments.length).toMatchInlineSnapshot(`1`);
			expect(sourceMap.toDocumentOffset(0)?.offset).toMatchInlineSnapshot(`10`);
		});

		it('builds multiple non-adjacent segments', () => {
			const builder = new SourceMapBuilder();
			builder
				.append('aaa', new DocumentRange('file://a.kql', new OffsetRange(0, 3)))
				.append(';')
				.append('bbb', new DocumentRange('file://b.kql', new OffsetRange(0, 3)));
			const { text, sourceMap } = builder.build();

			expect(text).toMatchInlineSnapshot(`"aaa;bbb"`);
			expect(sourceMap.segments.length).toMatchInlineSnapshot(`2`);
		});
	});

	describe('merging adjacent segments', () => {
		it('merges adjacent segments from same source', () => {
			const builder = new SourceMapBuilder();
			builder
				.append('hel', new DocumentRange('file://a.kql', new OffsetRange(0, 3)))
				.append('lo', new DocumentRange('file://a.kql', new OffsetRange(3, 5)));
			const { text, sourceMap } = builder.build();

			expect(text).toMatchInlineSnapshot(`"hello"`);
			expect(sourceMap.segments.length).toMatchInlineSnapshot(`1`);
			expect(sourceMap.segments[0].virtualRange.toString()).toMatchInlineSnapshot(`"[0, 5)"`);
			expect(sourceMap.segments[0].sourceRange.toString()).toMatchInlineSnapshot(`"[0, 5)"`);
		});

		it('does not merge non-adjacent source ranges', () => {
			const builder = new SourceMapBuilder();
			builder
				.append('aa', new DocumentRange('file://a.kql', new OffsetRange(0, 2)))
				.append('bb', new DocumentRange('file://a.kql', new OffsetRange(5, 7))); // gap in source
			const { text, sourceMap } = builder.build();

			expect(text).toMatchInlineSnapshot(`"aabb"`);
			expect(sourceMap.segments.length).toMatchInlineSnapshot(`2`);
		});

		it('does not merge segments from different files', () => {
			const builder = new SourceMapBuilder();
			builder
				.append('aa', new DocumentRange('file://a.kql', new OffsetRange(0, 2)))
				.append('bb', new DocumentRange('file://b.kql', new OffsetRange(2, 4)));
			const { text, sourceMap } = builder.build();

			expect(text).toMatchInlineSnapshot(`"aabb"`);
			expect(sourceMap.segments.length).toMatchInlineSnapshot(`2`);
		});

		it('does not merge when there is unmapped text in between', () => {
			const builder = new SourceMapBuilder();
			builder
				.append('aa', new DocumentRange('file://a.kql', new OffsetRange(0, 2)))
				.append(';') // unmapped
				.append('bb', new DocumentRange('file://a.kql', new OffsetRange(2, 4)));
			const { text, sourceMap } = builder.build();

			expect(text).toMatchInlineSnapshot(`"aa;bb"`);
			expect(sourceMap.segments.length).toMatchInlineSnapshot(`2`);
		});
	});

	describe('empty append', () => {
		it('ignores empty strings', () => {
			const builder = new SourceMapBuilder();
			builder
				.append('', new DocumentRange('file://a.kql', new OffsetRange(0, 0)))
				.append('hello');
			const { text, sourceMap } = builder.build();

			expect(text).toMatchInlineSnapshot(`"hello"`);
			expect(sourceMap.segments.length).toMatchInlineSnapshot(`0`);
		});
	});

	describe('length property', () => {
		it('tracks current length', () => {
			const builder = new SourceMapBuilder();
			expect(builder.length).toMatchInlineSnapshot(`0`);
			builder.append('hello');
			expect(builder.length).toMatchInlineSnapshot(`5`);
			builder.append(' world');
			expect(builder.length).toMatchInlineSnapshot(`11`);
		});
	});
});
