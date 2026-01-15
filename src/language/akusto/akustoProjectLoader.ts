import { FileSystem } from '../common/fileSystem';
import { AkustoDocument } from './akustoDocument';
import { AkustoProject } from './akustoProject';
import { parseInstructionExpression } from './instructionResolver';

/**
 * Loads Akusto documents from a file system.
 * Handles resolving :include() instructions.
 */
export class AkustoProjectLoader {
    constructor(private readonly fs: FileSystem) { }

    /**
     * Load a document and all its transitive includes.
     * Returns a project containing all loaded documents.
     */
    async loadDocument(uri: string): Promise<AkustoProject> {
        const documents = new Map<string, AkustoDocument>();
        await this._loadRecursive(uri, documents, new Set());
        return AkustoProject.fromDocuments(documents.values());
    }

    /**
     * Load multiple documents and their includes.
     */
    async loadDocuments(uris: string[]): Promise<AkustoProject> {
        const documents = new Map<string, AkustoDocument>();
        const loading = new Set<string>();

        for (const uri of uris) {
            await this._loadRecursive(uri, documents, loading);
        }

        return AkustoProject.fromDocuments(documents.values());
    }

    /**
     * Load a single document without resolving includes.
     * Useful when you just need one document's content.
     */
    async loadSingle(uri: string): Promise<AkustoDocument> {
        const { text } = await this.fs.readFile(uri);
        return AkustoDocument.parse(uri, text);
    }

    private async _loadRecursive(
        uri: string,
        documents: Map<string, AkustoDocument>,
        loading: Set<string>
    ): Promise<void> {
        // Normalize URI for comparison
        const normalizedUri = uri.replace(/\\/g, '/');

        // Cycle detection - check BEFORE checking if already loaded
        if (loading.has(normalizedUri)) {
            throw new Error(`Circular include detected: ${uri}`);
        }

        // Already loaded
        if (documents.has(normalizedUri)) {
            return;
        }

        loading.add(normalizedUri);

        // Load and parse document
        const { text } = await this.fs.readFile(uri);
        const doc = AkustoDocument.parse(normalizedUri, text);
        documents.set(normalizedUri, doc);

        // Find and resolve includes
        const includes = this._findIncludes(doc);
        for (const includePath of includes) {
            const resolvedUri = this.fs.resolvePath(normalizedUri, includePath);
            await this._loadRecursive(resolvedUri, documents, loading);
        }

        loading.delete(normalizedUri);
    }

    /**
     * Extract include paths from a document's instructions.
     */
    private _findIncludes(doc: AkustoDocument): string[] {
        const includes: string[] = [];

        const processInstructions = (instructions: { expression: string }[]) => {
            for (const instr of instructions) {
                const parsed = parseInstructionExpression(instr.expression);
                if (parsed.ok && parsed.instruction.type === 'include') {
                    includes.push(parsed.instruction.path);
                }
            }
        };

        // Top-level instructions
        processInstructions(doc.ast.getInstructions());

        // Chapter instructions
        for (const chapter of doc.ast.getChapters()) {
            processInstructions(chapter.getInstructions());
        }

        return includes;
    }
}
