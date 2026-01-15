import { SourceMap } from '../common/sourceMap';

/** Resolved Kusto document ready for language service operations. */
export class ResolvedKustoDocument {
	constructor(
		public readonly virtualText: string,
		public readonly sourceMap: SourceMap
	) {}
}
