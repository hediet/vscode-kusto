import { describe, test, expect } from 'vitest';
import { parseInstructionExpression } from './instructionResolver';

describe('parseInstructionExpression', () => {
    test('include with string', () => {
        const result = parseInstructionExpression('include("./defs.kql")');
        expect(result).toEqual({
            ok: true,
            instruction: { type: 'include', path: './defs.kql' }
        });
    });

    test('setDefaultDb with string', () => {
        const result = parseInstructionExpression('setDefaultDb("samples")');
        expect(result).toEqual({
            ok: true,
            instruction: { type: 'setDefaultDb', value: 'samples' }
        });
    });

    test('setConnection with azure identity', () => {
        const result = parseInstructionExpression('setConnection({ type: "azureIdentity", cluster: "help.kusto.windows.net" })');
        expect(result).toEqual({
            ok: true,
            instruction: {
                type: 'setConnection',
                value: { type: 'azureIdentity', cluster: 'help.kusto.windows.net' }
            }
        });
    });

    test('setConnection with connection string', () => {
        const result = parseInstructionExpression('setConnection({ type: "connectionString", connectionString: "Data Source=..." })');
        expect(result).toEqual({
            ok: true,
            instruction: {
                type: 'setConnection',
                value: { type: 'connectionString', connectionString: 'Data Source=...' }
            }
        });
    });

    test('setOutput with options', () => {
        const result = parseInstructionExpression('setOutput({ webEditorUrl: "https://example.com", fileExt: ".csv" })');
        expect(result).toEqual({
            ok: true,
            instruction: {
                type: 'setOutput',
                value: { webEditorUrl: 'https://example.com', fileExt: '.csv' }
            }
        });
    });

    test('nested object', () => {
        const result = parseInstructionExpression('setOutput({ nested: { level: 2 } })');
        expect(result).toEqual({
            ok: true,
            instruction: {
                type: 'setOutput',
                value: { nested: { level: 2 } }
            }
        });
    });

    test('array values', () => {
        const result = parseInstructionExpression('setOutput({ items: [1, 2, "three"] })');
        expect(result).toEqual({
            ok: true,
            instruction: {
                type: 'setOutput',
                value: { items: [1, 2, 'three'] }
            }
        });
    });

    test('boolean and null values', () => {
        const result = parseInstructionExpression('setOutput({ enabled: true, disabled: false, nothing: null })');
        expect(result).toEqual({
            ok: true,
            instruction: {
                type: 'setOutput',
                value: { enabled: true, disabled: false, nothing: null }
            }
        });
    });

    test('negative numbers', () => {
        const result = parseInstructionExpression('setOutput({ offset: -42 })');
        expect(result).toEqual({
            ok: true,
            instruction: {
                type: 'setOutput',
                value: { offset: -42 }
            }
        });
    });

    test('unknown function name', () => {
        const result = parseInstructionExpression('unknownFunc("test")');
        expect(result).toEqual({
            ok: false,
            error: 'Unknown instruction: unknownFunc()'
        });
    });

    test('invalid include - no argument', () => {
        const result = parseInstructionExpression('include()');
        expect(result).toEqual({
            ok: false,
            error: 'include() expects exactly one string argument'
        });
    });

    test('invalid include - wrong type', () => {
        const result = parseInstructionExpression('include(123)');
        expect(result).toEqual({
            ok: false,
            error: 'include() expects exactly one string argument'
        });
    });

    test('invalid setConnection - not an object', () => {
        const result = parseInstructionExpression('setConnection("invalid")');
        expect(result).toEqual({
            ok: false,
            error: 'setConnection() expects exactly one object argument'
        });
    });

    test('not a call expression', () => {
        const result = parseInstructionExpression('someVariable');
        expect(result).toEqual({
            ok: false,
            error: 'Expected a function call'
        });
    });

    test('string property name in quotes', () => {
        const result = parseInstructionExpression('setOutput({ "web-editor-url": "https://example.com" })');
        expect(result).toEqual({
            ok: true,
            instruction: {
                type: 'setOutput',
                value: { 'web-editor-url': 'https://example.com' }
            }
        });
    });
});
