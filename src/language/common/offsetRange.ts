/**
 * A range of offsets [start, endExclusive).
 * Immutable.
 */
export class OffsetRange {
	constructor(
		public readonly start: number,
		public readonly endExclusive: number
	) {
		if (start > endExclusive) {
			throw new Error(`Invalid OffsetRange: start (${start}) > endExclusive (${endExclusive})`);
		}
	}

	static empty(offset: number): OffsetRange {
		return new OffsetRange(offset, offset);
	}

	static ofLength(start: number, length: number): OffsetRange {
		return new OffsetRange(start, start + length);
	}

	get isEmpty(): boolean {
		return this.start === this.endExclusive;
	}

	get length(): number {
		return this.endExclusive - this.start;
	}

	contains(offset: number): boolean {
		return this.start <= offset && offset < this.endExclusive;
	}

	/**
	 * Check if offset is contained or touches the end.
	 * Useful for cursor positions where being at endExclusive should count.
	 */
	containsOrTouches(offset: number): boolean {
		return this.start <= offset && offset <= this.endExclusive;
	}

	containsRange(other: OffsetRange): boolean {
		return this.start <= other.start && other.endExclusive <= this.endExclusive;
	}

	intersects(other: OffsetRange): boolean {
		return this.start < other.endExclusive && other.start < this.endExclusive;
	}

	intersect(other: OffsetRange): OffsetRange | undefined {
		const start = Math.max(this.start, other.start);
		const endExclusive = Math.min(this.endExclusive, other.endExclusive);
		if (start >= endExclusive) {
			return undefined;
		}
		return new OffsetRange(start, endExclusive);
	}

	join(other: OffsetRange): OffsetRange {
		return new OffsetRange(
			Math.min(this.start, other.start),
			Math.max(this.endExclusive, other.endExclusive)
		);
	}

	/**
	 * Move this range by `delta`.
	 */
	delta(delta: number): OffsetRange {
		return new OffsetRange(this.start + delta, this.endExclusive + delta);
	}

	/**
	 * Extract substring from text using this range.
	 */
	substring(text: string): string {
		return text.substring(this.start, this.endExclusive);
	}

	equals(other: OffsetRange): boolean {
		return this.start === other.start && this.endExclusive === other.endExclusive;
	}

	toString(): string {
		return `[${this.start}, ${this.endExclusive})`;
	}

	toJSON(): { start: number; endExclusive: number } {
		return { start: this.start, endExclusive: this.endExclusive };
	}
}
