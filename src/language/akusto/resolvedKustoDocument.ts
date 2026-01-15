import { SourceMap } from '../common/sourceMap';
import { ResolvedInstruction } from './instructionTypes';

/** Resolved Kusto document ready for language service operations. */
export class ResolvedKustoDocument {
	constructor(
		public readonly virtualText: string,
		public readonly sourceMap: SourceMap,
		public readonly instructions: readonly ResolvedInstruction[] = []
	) { }
}
