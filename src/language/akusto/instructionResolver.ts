import * as ts from 'typescript';
import { ResolvedInstruction, IncludeInstruction, ConnectionConfig, OutputConfig } from './instructionTypes';

/** Result of parsing an instruction expression. */
export type ParsedInstruction =
    | { ok: true; instruction: ResolvedInstruction | IncludeInstruction }
    | { ok: false; error: string };

/** A JSON-compatible value. */
export type JsonValue =
    | string
    | number
    | boolean
    | null
    | JsonValue[]
    | { [key: string]: JsonValue };

/** Parse an instruction expression into a resolved instruction. */
export function parseInstructionExpression(expression: string): ParsedInstruction {
    // Parse as TypeScript
    const sourceFile = ts.createSourceFile(
        'instruction.ts',
        expression,
        ts.ScriptTarget.Latest,
        true
    );

    // Should have exactly one statement
    if (sourceFile.statements.length !== 1) {
        return { ok: false, error: 'Expected exactly one statement' };
    }

    const stmt = sourceFile.statements[0];

    // Must be an expression statement
    if (!ts.isExpressionStatement(stmt)) {
        return { ok: false, error: 'Expected an expression statement' };
    }

    const expr = stmt.expression;

    // Must be a call expression
    if (!ts.isCallExpression(expr)) {
        return { ok: false, error: 'Expected a function call' };
    }

    // Get function name
    if (!ts.isIdentifier(expr.expression)) {
        return { ok: false, error: 'Expected a simple function name' };
    }

    const functionName = expr.expression.text;

    // Parse arguments
    const args: JsonValue[] = [];
    for (const arg of expr.arguments) {
        const parsed = parseExpression(arg);
        if (!parsed.ok) {
            return { ok: false, error: `Invalid argument: ${parsed.error}` };
        }
        args.push(parsed.value);
    }

    // Map to instruction types
    switch (functionName) {
        case 'include':
            if (args.length !== 1 || typeof args[0] !== 'string') {
                return { ok: false, error: 'include() expects exactly one string argument' };
            }
            return { ok: true, instruction: { type: 'include', path: args[0] } };

        case 'setConnection':
            if (args.length !== 1 || typeof args[0] !== 'object' || args[0] === null || Array.isArray(args[0])) {
                return { ok: false, error: 'setConnection() expects exactly one object argument' };
            }
            return { ok: true, instruction: { type: 'setConnection', value: args[0] as ConnectionConfig } };

        case 'setDefaultDb':
            if (args.length !== 1 || typeof args[0] !== 'string') {
                return { ok: false, error: 'setDefaultDb() expects exactly one string argument' };
            }
            return { ok: true, instruction: { type: 'setDefaultDb', value: args[0] } };

        case 'setOutput':
            if (args.length !== 1 || typeof args[0] !== 'object' || args[0] === null || Array.isArray(args[0])) {
                return { ok: false, error: 'setOutput() expects exactly one object argument' };
            }
            return { ok: true, instruction: { type: 'setOutput', value: args[0] as OutputConfig } };

        default:
            return { ok: false, error: `Unknown instruction: ${functionName}()` };
    }
}

/** Result of parsing a TypeScript expression to JSON. */
type ExpressionResult =
    | { ok: true; value: JsonValue }
    | { ok: false; error: string };

/** Parse a TypeScript AST node to a JSON value. */
function parseExpression(node: ts.Expression): ExpressionResult {
    // String literal
    if (ts.isStringLiteral(node)) {
        return { ok: true, value: node.text };
    }

    // Numeric literal
    if (ts.isNumericLiteral(node)) {
        return { ok: true, value: Number(node.text) };
    }

    // Boolean / null keywords
    if (node.kind === ts.SyntaxKind.TrueKeyword) {
        return { ok: true, value: true };
    }
    if (node.kind === ts.SyntaxKind.FalseKeyword) {
        return { ok: true, value: false };
    }
    if (node.kind === ts.SyntaxKind.NullKeyword) {
        return { ok: true, value: null };
    }

    // Prefix unary (negative numbers)
    if (ts.isPrefixUnaryExpression(node)) {
        if (node.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(node.operand)) {
            return { ok: true, value: -Number(node.operand.text) };
        }
        if (node.operator === ts.SyntaxKind.PlusToken && ts.isNumericLiteral(node.operand)) {
            return { ok: true, value: Number(node.operand.text) };
        }
        return { ok: false, error: 'Unsupported prefix operator' };
    }

    // Array literal
    if (ts.isArrayLiteralExpression(node)) {
        const items: JsonValue[] = [];
        for (const element of node.elements) {
            if (ts.isSpreadElement(element)) {
                return { ok: false, error: 'Spread elements not supported' };
            }
            const parsed = parseExpression(element);
            if (!parsed.ok) {
                return parsed;
            }
            items.push(parsed.value);
        }
        return { ok: true, value: items };
    }

    // Object literal
    if (ts.isObjectLiteralExpression(node)) {
        const obj: { [key: string]: JsonValue } = {};
        for (const prop of node.properties) {
            if (ts.isPropertyAssignment(prop)) {
                const key = getPropertyName(prop.name);
                if (key === null) {
                    return { ok: false, error: 'Computed property names not supported' };
                }
                const parsed = parseExpression(prop.initializer);
                if (!parsed.ok) {
                    return parsed;
                }
                obj[key] = parsed.value;
            } else if (ts.isShorthandPropertyAssignment(prop)) {
                return { ok: false, error: 'Shorthand properties not supported' };
            } else if (ts.isSpreadAssignment(prop)) {
                return { ok: false, error: 'Spread properties not supported' };
            } else {
                return { ok: false, error: 'Unsupported property type' };
            }
        }
        return { ok: true, value: obj };
    }

    // Template literal (no expressions)
    if (ts.isNoSubstitutionTemplateLiteral(node)) {
        return { ok: true, value: node.text };
    }

    return { ok: false, error: `Unsupported expression type: ${ts.SyntaxKind[node.kind]}` };
}

/** Get property name from a property name node. */
function getPropertyName(node: ts.PropertyName): string | null {
    if (ts.isIdentifier(node)) {
        return node.text;
    }
    if (ts.isStringLiteral(node)) {
        return node.text;
    }
    if (ts.isNumericLiteral(node)) {
        return node.text;
    }
    // Computed property names not supported
    return null;
}
