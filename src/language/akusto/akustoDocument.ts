import { OffsetRange } from '../common/offsetRange';
import { KustoFragment } from './kustoFragment';

/**
 * Immutable Akusto document. Supports multiple fragments separated by empty lines,
 * and global variables via `let $name = ...` syntax.
 */
export class AkustoDocument {
	private constructor(
		public readonly uri: string,
		public readonly text: string,
		public readonly fragments: readonly KustoFragment[]
	) {}

	static parse(uri: string, text: string): AkustoDocument {
		const fragments = AkustoDocument._parseFragments(text);
		return new AkustoDocument(uri, text, fragments);
	}

	getFragmentAt(offset: number): KustoFragment | undefined {
		return this.fragments.find(f => f.range.contains(offset));
	}

	/** Fragments that export a name. */
	getDefinitions(): Map<string, KustoFragment> {
		const result = new Map<string, KustoFragment>();
		for (const fragment of this.fragments) {
			if (fragment.exportedName) {
				result.set(fragment.exportedName, fragment);
			}
		}
		return result;
	}

	private static _parseFragments(text: string): KustoFragment[] {
		const fragments: KustoFragment[] = [];
		const lines = text.split('\n');
		
		let fragmentStart = 0;
		let fragmentLines: string[] = [];
		let lineOffset = 0;

		const flushFragment = (endOffset: number) => {
			if (fragmentLines.length > 0) {
				const fragmentText = fragmentLines.join('\n');
				// Trim leading/trailing empty lines for the actual content, but keep range
				const trimmed = fragmentText.trim();
				if (trimmed.length > 0) {
					const range = new OffsetRange(fragmentStart, endOffset);
					const exported = AkustoDocument._parseExportedName(trimmed);
					const referenced = AkustoDocument._parseReferencedNames(trimmed, exported);
					fragments.push(new KustoFragment(trimmed, range, exported, referenced));
				}
			}
			fragmentLines = [];
		};

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			const lineEnd = lineOffset + line.length;
			const isEmptyLine = line.trim() === '';
			const isLastLine = i === lines.length - 1;

			if (isEmptyLine && fragmentLines.length > 0) {
				// End current fragment at end of previous line
				flushFragment(lineOffset > 0 ? lineOffset - 1 : 0);
				fragmentStart = lineEnd + (isLastLine ? 0 : 1); // +1 for newline
			} else if (!isEmptyLine) {
				if (fragmentLines.length === 0) {
					fragmentStart = lineOffset;
				}
				fragmentLines.push(line);
			}

			lineOffset = lineEnd + 1; // +1 for newline
		}

		// Flush remaining fragment
		if (fragmentLines.length > 0) {
			flushFragment(text.length);
		}

		return fragments;
	}

	// "let $events = ..." -> "$events"
	private static _parseExportedName(text: string): string | null {
		// Match: let $name = ...
		const match = text.match(/^\s*let\s+(\$[a-zA-Z_][a-zA-Z0-9_]*)\s*=/);
		return match ? match[1] : null;
	}

	// Excludes the exported name if present.
	private static _parseReferencedNames(text: string, excludeExported: string | null): string[] {
		const refs = new Set<string>();
		// Match all $identifier patterns
		const regex = /\$[a-zA-Z_][a-zA-Z0-9_]*/g;
		let match;
		while ((match = regex.exec(text)) !== null) {
			const name = match[0];
			if (name !== excludeExported) {
				refs.add(name);
			}
		}
		return Array.from(refs);
	}
}
