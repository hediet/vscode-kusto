/**
 * A position in a specific document, identified by URI and offset.
 */
export class DocumentOffset {
	constructor(
		public readonly uri: string,
		public readonly offset: number
	) {}

	equals(other: DocumentOffset): boolean {
		return this.uri === other.uri && this.offset === other.offset;
	}

	toString(): string {
		return `${this.uri}@${this.offset}`;
	}
}
