#!/usr/bin/env npx tsx

/**
 * Script to generate KQL event definitions from VS Code's telemetry schema.
 *
 * This CLI tool:
 * - Fetches telemetry schema from VS Code CLI or an input JSON file
 * - Optionally looks up event definitions in VS Code source code using TypeScript
 * - Generates KQL with documentation and source code links
 *
 * @example
 * ```bash
 * # Generate KQL from VS Code CLI output
 * npx tsx scripts/generate-telemetry-kql.ts -o demo/vscode-events.kql
 *
 * # Generate with source code links
 * npx tsx scripts/generate-telemetry-kql.ts -o demo/vscode-events.kql --vscode-path D:/dev/microsoft/vscode
 *
 * # Look up a specific symbol
 * npx tsx scripts/generate-telemetry-kql.ts --lookup "#MyClass.myMethod" --vscode-path D:/dev/microsoft/vscode
 * ```
 *
 * ## Symbol Reference Format
 *
 * The `--lookup` option supports the following formats:
 * - `symbolName` - finds a top-level symbol
 * - `#Container.member` - finds a member inside a container (class, interface, object)
 * - `#Container.nested.member` - finds nested members
 *
 * @module generate-telemetry-kql
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { TsSymbolResolver, createSourceLink, SymbolLocation, EnumValue, SourceLinkOptions } from './tsSymbolResolver';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Represents a telemetry property with classification and purpose metadata.
 */
interface TelemetryProperty {
    /** Data classification (e.g., "SystemMetaData", "CallstackOrException") */
    classification?: string;
    /** Purpose of collecting this data (e.g., "FeatureInsight", "PerformanceAndHealth") */
    purpose?: string;
    /** Human-readable description of the property */
    comment?: string;
    /** Endpoint URL if applicable */
    endPoint?: string;
    /** Whether this property is a numeric measurement */
    isMeasurement?: boolean | string;
    /** Code owner responsible for this property */
    owner?: string;
}

/**
 * Represents a telemetry event definition with its properties.
 */
interface TelemetryEvent {
    /** Code owner responsible for this event */
    owner?: string;
    /** Human-readable description of the event */
    comment?: string;
    /** Event properties (any key not matching reserved fields) */
    [propertyName: string]: TelemetryProperty | string | undefined;
}

/**
 * Represents a source of telemetry events (e.g., vscode-core, extensions).
 */
interface TelemetrySource {
    /** Map of event names to their definitions */
    events: Record<string, TelemetryEvent>;
}

/**
 * The complete telemetry schema containing all sources.
 */
interface TelemetrySchema {
    /** Map of source names to their event definitions */
    [sourceName: string]: TelemetrySource;
}

/**
 * Base columns from the RawEventsVSCode table.
 * These are renamed with "_" prefix to distinguish from extracted properties.
 */
const BASE_COLUMNS = [
    'AbexpAssignmentContext',
    'ApplicationVersion',
    'Attributes',
    'ClientTimestamp',
    'CommitHash',
    'CommonProduct',
    'DataHandlingTags',
    'DevDeviceId',
    'EventName',
    'Ext',
    'FirstSessionDate',
    'GeoCity',
    'GeoCountryRegionIso',
    'IdProperty',
    'InstanceId',
    'IsInternal',
    'IsNewSession',
    'LastSessionDate',
    'Measures',
    'MimeType',
    'NovaProperties',
    'OSVersion',
    'Platform',
    'Properties',
    'RendererVersion',
    'SchemaVersion',
    'Sequence',
    'ServerUploadTimestamp',
    'SessionId',
    'ShellVersion',
    'SQMMachineId',
    'Tags',
    'TimeSinceSessionStart',
    'VirtualMachineHint',
    'VSCodeMachineId',
    'WorkloadTags',
] as const;

/**
 * Parsed command-line arguments.
 */
interface ParsedArgs {
    /** Output file path */
    output?: string;
    /** Input JSON file path */
    input?: string;
    /** Filter by source name */
    source?: string;
    /** Filter by event name pattern (regex) */
    eventPattern?: string;
    /** Path to VS Code repository for source code lookup */
    vscodePath?: string;
    /** Symbol reference to look up (for --lookup mode) */
    lookup?: string;
    /** Show help message */
    help: boolean;
    /** Enable verbose output */
    verbose: boolean;
}

// ============================================================================
// Argument Parsing
// ============================================================================

/**
 * Parses command-line arguments.
 *
 * Supported options:
 * - `--output, -o <path>`: Output file path
 * - `--input, -i <path>`: Input JSON file path
 * - `--source, -s <name>`: Filter by source name
 * - `--event, -e <pattern>`: Filter by event name (regex)
 * - `--vscode-path <path>`: Path to VS Code repository
 * - `--lookup <ref>`: Look up a symbol reference
 * - `--help, -h`: Show help
 * - `--verbose, -v`: Enable verbose output
 *
 * @returns Parsed arguments
 */
function parseArgs(): ParsedArgs {
    const args = process.argv.slice(2);
    const result: ParsedArgs = { help: false, verbose: false };

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        switch (arg) {
            case '--output':
            case '-o':
                result.output = args[++i];
                break;
            case '--input':
            case '-i':
                result.input = args[++i];
                break;
            case '--source':
            case '-s':
                result.source = args[++i];
                break;
            case '--event':
            case '-e':
                result.eventPattern = args[++i];
                break;
            case '--vscode-path':
                result.vscodePath = args[++i];
                break;
            case '--lookup':
                result.lookup = args[++i];
                break;
            case '--help':
            case '-h':
                result.help = true;
                break;
            case '--verbose':
            case '-v':
                result.verbose = true;
                break;
        }
    }

    return result;
}

/**
 * Displays help message with usage examples.
 */
function showHelp(): void {
    console.log(`
Generate KQL event definitions from VS Code's telemetry schema.

USAGE:
  npx tsx scripts/generate-telemetry-kql.ts [options]

OPTIONS:
  --output, -o <path>     Output file path (default: stdout)
  --input, -i <path>      Input JSON file path (default: runs 'code --telemetry')
  --source, -s <name>     Filter by source (e.g., "vscode-core")
  --event, -e <pattern>   Filter by event name pattern (regex)
  --vscode-path <path>    Path to VS Code repository for source code lookup
  --lookup <ref>          Look up a symbol reference and exit
  --verbose, -v           Enable verbose output
  --help, -h              Show this help message

SYMBOL REFERENCE FORMAT:
  The --lookup option supports these formats:
  - "SymbolName"                Find a top-level symbol
  - "#Container.member"         Find a member inside a container
  - "#Container.nested.member"  Find nested members

EXAMPLES:
  # Generate all events to stdout
  npx tsx scripts/generate-telemetry-kql.ts

  # Generate to file from existing JSON
  npx tsx scripts/generate-telemetry-kql.ts -i telemetry.json -o demo/vscode-events.kql

  # Generate with source code links
  npx tsx scripts/generate-telemetry-kql.ts --vscode-path D:/dev/microsoft/vscode -o demo/events.kql

  # Filter by source
  npx tsx scripts/generate-telemetry-kql.ts -s vscode-core -o demo/core-events.kql

  # Filter by event pattern
  npx tsx scripts/generate-telemetry-kql.ts -e "debug.*" -o demo/debug-events.kql

  # Look up a symbol in VS Code source
  npx tsx scripts/generate-telemetry-kql.ts --lookup "#TelemetryService.publicLog" --vscode-path D:/dev/vscode
`);
}

// ============================================================================
// Telemetry Schema Processing
// ============================================================================

/**
 * Retrieves the telemetry schema from VS Code CLI or an input file.
 *
 * @param inputPath - Optional path to a JSON file containing the schema
 * @returns The parsed telemetry schema
 */
function getTelemetrySchema(inputPath?: string): TelemetrySchema {
    if (inputPath) {
        const content = fs.readFileSync(inputPath, 'utf-8');
        return JSON.parse(content);
    }

    console.error('Fetching telemetry schema from VS Code CLI...');
    const output = execSync('code --telemetry', {
        encoding: 'utf-8',
        maxBuffer: 50 * 1024 * 1024
    });
    return JSON.parse(output);
}

/**
 * Converts an event name to a valid KQL variable identifier.
 *
 * @param name - The original event name
 * @returns A valid KQL identifier
 *
 * @example
 * toKqlIdentifier("debug/sessionStart") // "debug.sessionStart"
 * toKqlIdentifier("my-event:action") // "my_event_action"
 */
function toKqlIdentifier(name: string): string {
    return name
        .replace(/[\/\\]/g, '.')
        .replace(/[^a-zA-Z0-9._]/g, '_')
        .replace(/\.+/g, '.')
        .replace(/_+/g, '_')
        .replace(/^[._]+|[._]+$/g, '');
}

/**
 * Converts a lowercase property name to PascalCase.
 * Handles names with dots and common patterns.
 *
 * @param name - The lowercase property name
 * @returns PascalCase version of the name
 *
 * @example
 * toPascalCase("eventid") // "EventId"
 * toPascalCase("sourceextensionid") // "SourceExtensionId"
 */
function toPascalCase(name: string): string {
    // Replace dots with underscores first
    let result = name.replace(/\./g, '_').toLowerCase();
    
    // Known compound patterns to handle specially (pattern -> replacement)
    const compoundPatterns: [RegExp, string][] = [
        [/applycodeblocksuggestion/g, 'apply_code_block_suggestion'],
        [/codeblock/g, 'code_block'],
        [/sourceextension/g, 'source_extension'],
        [/sourceprovider/g, 'source_provider'],
        [/editchars/g, 'edit_chars'],
        [/editlines/g, 'edit_lines'],
    ];
    
    // Apply compound pattern replacements
    for (const [pattern, replacement] of compoundPatterns) {
        result = result.replace(pattern, replacement);
    }
    
    // Known suffixes that should be capitalized
    const suffixPatterns: [RegExp, string][] = [
        [/suggestion$/g, '_suggestion'],
        [/extension$/g, '_extension'],
        [/provider$/g, '_provider'],
        [/version$/g, '_version'],
        [/inserted$/g, '_inserted'],
        [/deleted$/g, '_deleted'],
        [/language$/g, '_language'],
        [/id$/g, '_id'],
    ];
    
    // Apply suffix patterns
    for (const [pattern, replacement] of suffixPatterns) {
        result = result.replace(pattern, replacement);
    }
    
    // Clean up underscores
    result = result.replace(/_+/g, '_').replace(/^_|_$/g, '');
    
    // Split by underscore and capitalize each part
    return result.split('_').map(part => 
        part.charAt(0).toUpperCase() + part.slice(1)
    ).join('');
}

/**
 * Determines the KQL type information for a telemetry property.
 *
 * @param prop - The telemetry property definition
 * @returns Object containing the accessor and converter function
 */
function getKqlType(prop: TelemetryProperty): {
    accessor: 'Properties' | 'Measures';
    converter: string;
} {
    const isMeasurement = prop.isMeasurement === true || prop.isMeasurement === 'true';
    if (isMeasurement) {
        return { accessor: 'Measures', converter: 'toreal' };
    }
    return { accessor: 'Properties', converter: 'tostring' };
}

/**
 * Wraps text to a maximum line width, breaking on word boundaries.
 *
 * @param text - The text to wrap
 * @param maxWidth - Maximum characters per line
 * @returns Array of wrapped lines
 */
function wrapText(text: string, maxWidth: number): string[] {
    // Don't break lines that contain markdown links (they need to stay intact)
    if (text.includes('](')) {
        return [text];
    }

    const words = text.split(/\s+/);
    const lines: string[] = [];
    let currentLine = '';

    for (const word of words) {
        if (currentLine.length === 0) {
            currentLine = word;
        } else if (currentLine.length + 1 + word.length <= maxWidth) {
            currentLine += ' ' + word;
        } else {
            lines.push(currentLine);
            currentLine = word;
        }
    }

    if (currentLine.length > 0) {
        lines.push(currentLine);
    }

    return lines.length > 0 ? lines : [''];
}

// ============================================================================
// Source Code Lookup
// ============================================================================

/**
 * Creates a TypeScript symbol resolver for the VS Code repository.
 *
 * @param vscodePath - Path to the VS Code repository
 * @returns A configured TsSymbolResolver instance, or null if not available
 */
function createVsCodeResolver(vscodePath: string): TsSymbolResolver | null {
    const tsconfigPath = path.join(vscodePath, 'src', 'tsconfig.json');

    if (!fs.existsSync(tsconfigPath)) {
        // Try the root tsconfig
        const rootTsconfig = path.join(vscodePath, 'tsconfig.json');
        if (!fs.existsSync(rootTsconfig)) {
            console.error(`Warning: No tsconfig.json found in ${vscodePath}`);
            return null;
        }
        return new TsSymbolResolver({
            projectRoot: vscodePath,
            tsconfigPath: rootTsconfig
        });
    }

    return new TsSymbolResolver({
        projectRoot: vscodePath,
        tsconfigPath
    });
}

/**
 * Gets the current git commit hash from a repository.
 *
 * @param repoPath - Path to the git repository
 * @returns The full commit hash, or null if not available
 */
function getGitCommitHash(repoPath: string): string | null {
    try {
        const hash = execSync('git rev-parse HEAD', {
            cwd: repoPath,
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe']
        }).trim();
        return hash || null;
    } catch {
        return null;
    }
}

/**
 * Gets the GitHub repository URL from git remote.
 *
 * @param repoPath - Path to the git repository
 * @returns The GitHub URL, or null if not available
 */
function getGitHubRepoUrl(repoPath: string): string | null {
    try {
        const remote = execSync('git remote get-url origin', {
            cwd: repoPath,
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe']
        }).trim();
        
        // Convert git@github.com:org/repo.git or https://github.com/org/repo.git to https://github.com/org/repo
        const match = remote.match(/github\.com[:\/](.+?)(\.git)?$/);
        if (match) {
            return `https://github.com/${match[1]}`;
        }
        return null;
    } catch {
        return null;
    }
}

/**
 * Regex to match symbol references in comments (e.g., #IEditTelemetryBaseData.presentation)
 */
const SYMBOL_REF_REGEX = /#([A-Z][A-Za-z0-9]*(?:\.[a-zA-Z][A-Za-z0-9]*)*)/g;

/**
 * Processes comment text, replacing symbol references with source links.
 *
 * Symbol references follow the format: #SymbolName or #Container.member
 * If a symbol can be resolved, it's replaced with a markdown link.
 * If not found, the original reference is kept as-is.
 *
 * @param text - The comment text to process
 * @param resolver - The TypeScript symbol resolver
 * @param vscodePath - Path to VS Code repository for relative links
 * @param linkOptions - Options for source link generation
 * @param verbose - Whether to log resolution failures
 * @returns The processed text with resolved references
 */
function resolveSymbolRefsInText(
    text: string,
    resolver: TsSymbolResolver,
    vscodePath: string,
    linkOptions?: SourceLinkOptions,
    verbose?: boolean
): string {
    return text.replace(SYMBOL_REF_REGEX, (match, symbolPath) => {
        const location = resolver.findSymbol(`#${symbolPath}`);
        if (location) {
            return createSourceLink(location, vscodePath, linkOptions);
        }
        if (verbose) {
            console.error(`  Warning: Symbol ref not resolved: #${symbolPath}`);
        }
        return match; // Keep original if not found
    });
}

/**
 * Extracts all symbol refs from text and returns enum values for each.
 * 
 * @param text - Text containing `#Symbol.ref` patterns
 * @param resolver - The TypeScript symbol resolver
 * @param verbose - Whether to log warnings
 * @returns Array of enum values found from all symbol refs
 */
function extractEnumVariantsFromText(
    text: string,
    resolver: TsSymbolResolver,
    verbose?: boolean
): EnumValue[] {
    const variants: EnumValue[] = [];
    const matches = text.matchAll(SYMBOL_REF_REGEX);
    
    for (const match of matches) {
        const symbolPath = match[1];
        const enumValues = resolver.getEnumValues(`#${symbolPath}`);
        if (enumValues.length > 0) {
            variants.push(...enumValues);
        } else if (verbose) {
            // Only log if we expected to find enum values (member access pattern)
            if (symbolPath.includes('.')) {
                console.error(`  Note: No enum values for #${symbolPath}`);
            }
        }
    }
    
    return variants;
}

/**
 * Attempts to find the source location of a telemetry event.
 *
 * This function tries various strategies to locate the event definition:
 * 1. Search for the event name as a string literal (most reliable, uses index)
 * 2. Search for a top-level symbol with a similar name
 *
 * Note: We skip expensive pattern matching (`findSymbols`) for performance.
 * The string literal index should find most telemetry events.
 *
 * @param resolver - The TypeScript symbol resolver
 * @param eventName - The telemetry event name
 * @param owner - The event owner (code owner alias)
 * @returns The symbol location if found, null otherwise
 */
function findEventSource(
    resolver: TsSymbolResolver,
    eventName: string,
    owner?: string
): SymbolLocation | null {
    // Strategy 1: Search for the event name as a string literal
    // This is the most reliable way to find telemetry event definitions
    // Uses the pre-built string literal index for O(1) lookup
    const stringLocation = resolver.findStringLiteral(eventName);
    if (stringLocation) {
        return stringLocation;
    }

    // Strategy 2: Convert event name to a potential symbol name
    // e.g., "workbenchActionExecuted" -> "WorkbenchActionExecuted"
    const symbolName = eventName
        .replace(/[:/]/g, '_')
        .replace(/^./, c => c.toUpperCase());

    const direct = resolver.findSymbol(symbolName);
    if (direct) {
        return direct;
    }

    // Skip slow pattern matching - string literal index should find most events
    return null;
}

// ============================================================================
// KQL Generation
// ============================================================================

/**
 * Generates the $base let statement with multi-line project.
 * Projects base columns with "_" prefix.
 */
function generateBaseDefinition(): string {
    const projections = BASE_COLUMNS.map(col => `    _${col} = ${col}`);
    return `let $base = RawEventsVSCode\n| project\n${projections.join(',\n')};`;
}

/**
 * Generates KQL code for a single telemetry event.
 *
 * @param eventName - The event name
 * @param event - The event definition
 * @param sourceName - The source name (e.g., "vscode-core")
 * @param options - Generation options including resolver and vscodePath
 * @returns Generated KQL code as a string
 */
function generateEventKql(
    eventName: string,
    event: TelemetryEvent,
    sourceName: string,
    options: {
        sourceLocation?: SymbolLocation;
        vscodePath?: string;
        resolver?: TsSymbolResolver | null;
        linkOptions?: SourceLinkOptions;
        verbose?: boolean;
    }
): string {
    const { sourceLocation, vscodePath, resolver, linkOptions, verbose } = options;
    const lines: string[] = [];

    // Build the full event name based on source
    let eventNamePrefix = '';
    if (sourceName === 'vscode-core') {
        eventNamePrefix = 'monacoworkbench/';
    } else if (sourceName.startsWith('vscode-default-extensions')) {
        const extMatch = sourceName.match(/vscode-default-extensions\/(.+)/);
        if (extMatch) {
            eventNamePrefix = `${extMatch[1]}/`;
        }
    }

    const fullEventName = `${eventNamePrefix}${eventName}`;
    const varName = `$events.${toKqlIdentifier(eventName)}`;

    // Extract properties (exclude metadata fields)
    const metadataFields = new Set(['owner', 'comment']);
    const properties: Array<{ name: string; prop: TelemetryProperty }> = [];

    for (const [key, value] of Object.entries(event)) {
        if (metadataFields.has(key)) continue;
        if (typeof value === 'object' && value !== null) {
            properties.push({ name: key, prop: value as TelemetryProperty });
        }
    }

    // Generate documentation comment block
    const descriptionLines: string[] = [];
    const metadataParts: string[] = [];

    // Add main description (resolve symbol refs if resolver available)
    if (event.comment) {
        let commentText = event.comment;
        if (resolver && vscodePath) {
            commentText = resolveSymbolRefsInText(commentText, resolver, vscodePath, linkOptions, verbose);
        }
        descriptionLines.push(commentText);
    }

    // Add owner to metadata line
    if (event.owner) {
        metadataParts.push(`**Owner:** ${event.owner}`);
    }

    // Add source code link to metadata line
    if (sourceLocation && vscodePath) {
        const link = createSourceLink(sourceLocation, vscodePath, linkOptions);
        metadataParts.push(link);
    }

    // Write documentation using single-line comments
    if (descriptionLines.length > 0 || metadataParts.length > 0) {
        // Write description
        for (const docLine of descriptionLines) {
            const wrappedLines = wrapText(docLine, 100);
            for (const line of wrappedLines) {
                lines.push(`// ${line}`);
            }
        }
        // Add empty comment for paragraph break before metadata
        if (descriptionLines.length > 0 && metadataParts.length > 0) {
            lines.push(`//`);
        }
        // Write metadata (owner + source) on one line
        if (metadataParts.length > 0) {
            lines.push(`// ${metadataParts.join(' | ')}`);
        }
    }

    // Start the let statement (using $base which has renamed columns)
    lines.push(`let ${varName} = $base`);
    lines.push(`| where _EventName == "${fullEventName.toLowerCase()}"`);

    // Build a map of original property casing from source file
    let propertyCasing = new Map<string, string>();
    if (sourceLocation && resolver) {
        const lowercaseKeys = new Set(properties.map(p => p.name.toLowerCase()));
        propertyCasing = resolver.findPropertyCasing(sourceLocation.filePath, lowercaseKeys);
    }

    // Collect property projections for multi-line project
    const propertyProjections: { comment: string[]; projection: string }[] = [];

    for (const { name, prop } of properties) {
        const { accessor, converter } = getKqlType(prop);
        // Property key is lowercase (as stored in telemetry)
        const propKey = name.toLowerCase();
        // Column name: use original casing from source if found, otherwise PascalCase
        const originalCasing = propertyCasing.get(propKey);
        const columnName = originalCasing
            ? originalCasing.charAt(0).toUpperCase() + originalCasing.slice(1)
            : toPascalCase(name);
        
        // Build comment content for this property
        const propDocLines: string[] = [];
        const enumVariantLines: string[] = [];
        
        // Add property description comment
        if (prop.comment) {
            let commentText = prop.comment;
            if (resolver && vscodePath) {
                commentText = resolveSymbolRefsInText(commentText, resolver, vscodePath, linkOptions, verbose);
                
                // Extract enum variants from symbol refs in the comment
                const enumVariants = extractEnumVariantsFromText(prop.comment, resolver, verbose);
                for (const variant of enumVariants) {
                    if (typeof variant.value === 'string') {
                        const desc = variant.description ? ` - ${variant.description}` : '';
                        enumVariantLines.push(`@enum-variant "${variant.value}"${desc}`);
                    } else if (typeof variant.value === 'number') {
                        const desc = variant.description ? ` - ${variant.description}` : '';
                        enumVariantLines.push(`@enum-variant ${variant.value}${desc}`);
                    }
                }
            }
            propDocLines.push(commentText);
        }
        
        // Collect comments for this property
        const commentLines: string[] = [];
        if (propDocLines.length > 0 || enumVariantLines.length > 0) {
            for (const docLine of propDocLines) {
                const wrappedLines = wrapText(docLine, 100);
                for (const line of wrappedLines) {
                    commentLines.push(`    // ${line}`);
                }
            }
            for (const enumLine of enumVariantLines) {
                commentLines.push(`    // ${enumLine}`);
            }
        }
        
        propertyProjections.push({
            comment: commentLines,
            projection: `    ${columnName} = ${converter}(${accessor}["${propKey}"])`
        });
    }

    // Generate multi-line project statement
    if (propertyProjections.length > 0) {
        lines.push(`| project`);
        // First add base columns (they come from $base with _* names)
        lines.push(`    _*,`);
        // Then add extracted properties with their comments
        for (let i = 0; i < propertyProjections.length; i++) {
            const { comment, projection } = propertyProjections[i];
            // Add property comments
            for (const c of comment) {
                lines.push(c);
            }
            // Add projection with comma (except for last one)
            const isLast = i === propertyProjections.length - 1;
            lines.push(isLast ? projection : `${projection},`);
        }
    }

    return lines.join('\n');
}

/**
 * Generates the complete KQL file from the telemetry schema.
 *
 * @param schema - The telemetry schema
 * @param options - Generation options
 * @returns The complete KQL file content
 */
function generateKqlFile(
    schema: TelemetrySchema,
    options: {
        sourceFilter?: string;
        eventPattern?: string;
        vscodePath?: string;
        outputPath?: string;
        verbose?: boolean;
    }
): string {
    const totalStartTime = performance.now();
    const sections: string[] = [];
    let resolver: TsSymbolResolver | null = null;
    let linkOptions: SourceLinkOptions | undefined;

    // Initialize resolver if VS Code path is provided
    if (options.vscodePath) {
        const loadStart = performance.now();
        console.error(`[Timing] Loading TypeScript project from ${options.vscodePath}...`);
        resolver = createVsCodeResolver(options.vscodePath);
        if (resolver) {
            const stats = resolver.getStats();
            console.error(`[Timing] Project loaded in ${((performance.now() - loadStart) / 1000).toFixed(1)}s - ${stats.sourceFileCount} files, ${stats.topLevelSymbolCount} symbols`);
        }

        // Get git info for link generation
        const commitHash = getGitCommitHash(options.vscodePath);
        const repoUrl = getGitHubRepoUrl(options.vscodePath);
        if (commitHash) {
            console.error(`[Timing] Git commit: ${commitHash.substring(0, 8)}`);
        }
        if (repoUrl) {
            console.error(`[Timing] GitHub repo: ${repoUrl}`);
        }

        linkOptions = {
            outputPath: options.outputPath,
            commitHash: commitHash ?? undefined,
            repoUrl: repoUrl ?? undefined,
        };
    }

    // Count total events for progress reporting
    const eventRegex = options.eventPattern ? new RegExp(options.eventPattern, 'i') : null;
    let totalEvents = 0;
    for (const [sourceName, source] of Object.entries(schema)) {
        if (options.sourceFilter && !sourceName.includes(options.sourceFilter)) continue;
        if (!source.events) continue;
        for (const [eventName] of Object.entries(source.events)) {
            if (eventRegex && !eventRegex.test(eventName)) continue;
            totalEvents++;
        }
    }
    console.error(`[Timing] Processing ${totalEvents} events...`);

    // Add header
    sections.push(`// VS Code Telemetry Events Library`);
    sections.push(`// Generated: ${new Date().toISOString()}`);
    sections.push(`// Source: code --telemetry`);
    if (options.vscodePath) {
        sections.push(`// VS Code Source: ${options.vscodePath}`);
        if (linkOptions?.commitHash) {
            sections.push(`// Git Commit: ${linkOptions.commitHash}`);
        }
    }
    sections.push('');
    sections.push(`:setConnection({ type: "azureCli", cluster: "https://ddtelvscode.kusto.windows.net/" })`);
    sections.push(`:setDefaultDb("VSCode")`);
    sections.push('');
    
    // Add $base definition with renamed columns
    sections.push('// Base table with renamed columns');
    sections.push(generateBaseDefinition());
    sections.push('');

    let eventsGenerated = 0;
    let eventsWithSource = 0;
    let lastProgress = 0;
    
    // Timing accumulators
    let findEventSourceTime = 0;
    let generateEventKqlTime = 0;
    const processEventsStart = performance.now();

    for (const [sourceName, source] of Object.entries(schema)) {
        // Apply source filter
        if (options.sourceFilter && !sourceName.includes(options.sourceFilter)) {
            continue;
        }

        if (!source.events) continue;

        const eventEntries = Object.entries(source.events);
        if (eventEntries.length === 0) continue;

        // Add source section header
        sections.push('');
        sections.push(`// ============================================================================`);
        sections.push(`// Source: ${sourceName}`);
        sections.push(`// ============================================================================`);
        sections.push('');

        for (const [eventName, event] of eventEntries) {
            // Apply event pattern filter
            if (eventRegex && !eventRegex.test(eventName)) {
                continue;
            }

            // Try to find source location
            let sourceLocation: SymbolLocation | undefined;
            if (resolver) {
                const findStart = performance.now();
                const location = findEventSource(resolver, eventName, event.owner);
                findEventSourceTime += performance.now() - findStart;
                if (location) {
                    sourceLocation = location;
                    eventsWithSource++;
                    if (options.verbose) {
                        console.error(`Found source for ${eventName}: ${location.filePath}:${location.line}`);
                    }
                }
            }

            const genStart = performance.now();
            const eventKql = generateEventKql(
                eventName,
                event,
                sourceName,
                {
                    sourceLocation,
                    vscodePath: options.vscodePath,
                    resolver,
                    linkOptions,
                    verbose: options.verbose
                }
            );
            generateEventKqlTime += performance.now() - genStart;
            
            sections.push(eventKql);
            sections.push('');
            eventsGenerated++;

            // Progress reporting (every 10%)
            const progress = Math.floor((eventsGenerated / totalEvents) * 100);
            if (progress >= lastProgress + 10) {
                const elapsed = ((performance.now() - processEventsStart) / 1000).toFixed(1);
                console.error(`[Timing] Progress: ${progress}% (${eventsGenerated}/${totalEvents}) - ${elapsed}s elapsed`);
                lastProgress = progress;
            }
        }
    }

    const totalTime = (performance.now() - totalStartTime) / 1000;
    const processTime = (performance.now() - processEventsStart) / 1000;
    
    console.error(`[Timing] === Summary ===`);
    console.error(`[Timing] Total time: ${totalTime.toFixed(1)}s`);
    console.error(`[Timing] Event processing: ${processTime.toFixed(1)}s`);
    console.error(`[Timing]   - findEventSource: ${(findEventSourceTime / 1000).toFixed(1)}s`);
    console.error(`[Timing]   - generateEventKql: ${(generateEventKqlTime / 1000).toFixed(1)}s`);
    console.error(`[Timing] Generated ${eventsGenerated} events (${eventsWithSource} with source links)`);

    // Add footer stats as comment
    sections.push(`// ============================================================================`);
    sections.push(`// Statistics`);
    sections.push(`// ============================================================================`);
    sections.push(`// Total events: ${eventsGenerated}`);
    if (resolver) {
        sections.push(`// Events with source links: ${eventsWithSource}`);
    }

    return sections.join('\n');
}

// ============================================================================
// CLI Commands
// ============================================================================

/**
 * Handles the --lookup command to find and display a symbol.
 *
 * @param symbolRef - The symbol reference to look up
 * @param vscodePath - Path to VS Code repository
 */
function handleLookup(symbolRef: string, vscodePath: string): void {
    console.log(`Looking up symbol: ${symbolRef}`);
    console.log(`In VS Code repository: ${vscodePath}`);
    console.log('');

    const resolver = createVsCodeResolver(vscodePath);
    if (!resolver) {
        console.error('Failed to create resolver');
        process.exit(1);
    }

    // Show project stats
    const stats = resolver.getStats();
    console.log(`Project stats:`);
    console.log(`  Source files: ${stats.sourceFileCount}`);
    console.log(`  Top-level symbols: ${stats.topLevelSymbolCount}`);
    console.log('');

    // Check if target file is loaded (for debugging)
    const targetFile = 'aiEditTelemetryService.ts';
    console.log(`Checking if ${targetFile} is loaded: ${resolver.hasFile(targetFile)}`);
    console.log('');

    const location = resolver.findSymbol(symbolRef);
    if (location) {
        console.log('Found symbol:');
        console.log(`  Name: ${location.name}`);
        console.log(`  Kind: ${location.kindName}`);
        console.log(`  File: ${location.filePath}`);
        console.log(`  Line: ${location.line}`);
        console.log(`  Column: ${location.column}`);
        if (location.documentation) {
            console.log(`  Documentation: ${location.documentation}`);
        }
        console.log('');
        console.log(`Link: ${createSourceLink(location, vscodePath)}`);
        
        // Try to get enum values
        const enumValues = resolver.getEnumValues(symbolRef);
        if (enumValues.length > 0) {
            console.log('');
            console.log('Enum values:');
            for (const ev of enumValues) {
                const desc = ev.description ? ` - ${ev.description}` : '';
                console.log(`  ${JSON.stringify(ev.value)}${desc}`);
            }
        }
    } else {
        console.log(`Symbol not found: ${symbolRef}`);
        process.exit(1);
    }
}

/**
 * Main entry point for the CLI tool.
 */
async function main(): Promise<void> {
    const args = parseArgs();

    if (args.help) {
        showHelp();
        process.exit(0);
    }

    // Handle --lookup mode
    if (args.lookup) {
        if (!args.vscodePath) {
            console.error('Error: --lookup requires --vscode-path');
            process.exit(1);
        }
        handleLookup(args.lookup, args.vscodePath);
        process.exit(0);
    }

    try {
        const schemaStart = performance.now();
        const schema = getTelemetrySchema(args.input);
        console.error(`[Timing] Schema loaded in ${((performance.now() - schemaStart) / 1000).toFixed(1)}s`);
        
        const kql = generateKqlFile(schema, {
            sourceFilter: args.source,
            eventPattern: args.eventPattern,
            vscodePath: args.vscodePath,
            outputPath: args.output,
            verbose: args.verbose
        });

        if (args.output) {
            const outputDir = path.dirname(args.output);
            if (!fs.existsSync(outputDir)) {
                fs.mkdirSync(outputDir, { recursive: true });
            }
            fs.writeFileSync(args.output, kql, 'utf-8');
            console.error(`[Timing] Generated KQL file: ${args.output}`);
        } else {
            console.log(kql);
        }
    } catch (error) {
        console.error('Error:', error instanceof Error ? error.message : error);
        process.exit(1);
    }
}

main();
