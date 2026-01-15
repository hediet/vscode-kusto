import { OffsetRange } from '../common/offsetRange';

/**
 * Immutable fragment of Kusto code. Fragments are separated by empty lines.
 */
export class KustoFragment {
	constructor(
		public readonly text: string,
		public readonly range: OffsetRange,
		/** e.g. "$events" from "let $events = ..." */
		public readonly exportedName: string | null,
		public readonly referencedNames: readonly string[]
	) {}

	get isDefinition(): boolean {
		return this.exportedName !== null;
	}

	toString(): string {
		const exported = this.exportedName ? ` exports=${this.exportedName}` : '';
		const refs = this.referencedNames.length > 0 ? ` refs=[${this.referencedNames.join(', ')}]` : '';
		return `KustoFragment(${this.range}${exported}${refs})`;
	}
}
