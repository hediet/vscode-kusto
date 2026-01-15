import { SourceMapBuilder, DocumentRange } from '../common/sourceMapBuilder';
import { ResolvedKustoDocument } from './resolvedKustoDocument';
import { AkustoDocument } from './akustoDocument';
import { KustoFragment } from './kustoFragment';

/** Reference to a fragment within a document. */
export class FragmentRef {
	constructor(
		public readonly document: AkustoDocument,
		public readonly fragment: KustoFragment
	) {}
}

/** Immutable project containing multiple Akusto documents. */
export class AkustoProject {
	private readonly _definitionCache: Map<string, FragmentRef> | null = null;

	private constructor(
		public readonly documents: ReadonlyMap<string, AkustoDocument>
	) {}

	static empty(): AkustoProject {
		return new AkustoProject(new Map());
	}

	static fromDocuments(documents: Iterable<AkustoDocument>): AkustoProject {
		const map = new Map<string, AkustoDocument>();
		for (const doc of documents) {
			map.set(doc.uri, doc);
		}
		return new AkustoProject(map);
	}

	withDocument(doc: AkustoDocument): AkustoProject {
		const newDocs = new Map(this.documents);
		newDocs.set(doc.uri, doc);
		return new AkustoProject(newDocs);
	}

	withoutDocument(uri: string): AkustoProject {
		const newDocs = new Map(this.documents);
		newDocs.delete(uri);
		return new AkustoProject(newDocs);
	}

	getDefinitions(): Map<string, FragmentRef> {
		const result = new Map<string, FragmentRef>();
		for (const doc of this.documents.values()) {
			for (const fragment of doc.fragments) {
				if (fragment.exportedName) {
					result.set(fragment.exportedName, new FragmentRef(doc, fragment));
				}
			}
		}
		return result;
	}

	getDefinition(name: string): FragmentRef | undefined {
		for (const doc of this.documents.values()) {
			for (const fragment of doc.fragments) {
				if (fragment.exportedName === name) {
					return new FragmentRef(doc, fragment);
				}
			}
		}
		return undefined;
	}

	/** @throws Error on cyclic dependencies */
	resolve(targetDoc: AkustoDocument, targetFragment: KustoFragment): ResolvedKustoDocument {
		const deps = this._getTransitiveDependencies(targetFragment);
		const builder = new SourceMapBuilder();

		for (const dep of deps) {
			builder.append(dep.fragment.text, new DocumentRange(dep.document.uri, dep.fragment.range));
			builder.append(';\n');
		}

		builder.append(targetFragment.text, new DocumentRange(targetDoc.uri, targetFragment.range));

		const { text, sourceMap } = builder.build();
		return new ResolvedKustoDocument(text, sourceMap);
	}

	// In topological order, throws on cyclic dependencies.
	private _getTransitiveDependencies(targetFragment: KustoFragment): FragmentRef[] {
		const visited = new Set<string>();
		const visiting = new Set<string>(); // For cycle detection
		const result: FragmentRef[] = [];

		const visit = (names: readonly string[]) => {
			for (const name of names) {
				if (visited.has(name)) {
					continue;
				}
				if (visiting.has(name)) {
					throw new Error(`Cyclic dependency detected: ${name}`);
				}

				const def = this.getDefinition(name);
				if (!def) {
					// Unknown reference - skip (might be a built-in or external)
					continue;
				}

				visiting.add(name);
				visit(def.fragment.referencedNames);
				visiting.delete(name);

				visited.add(name);
				result.push(def);
			}
		};

		visit(targetFragment.referencedNames);
		return result;
	}
}
