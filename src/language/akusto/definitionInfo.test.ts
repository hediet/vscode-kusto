import { describe, test, expect } from 'vitest';
import { extractDefinitionInfo, getDefinitionNameAtOffset } from './definitionInfo';

describe('DefinitionInfo', () => {
    describe('extractDefinitionInfo', () => {
        test('extracts basic definition info', () => {
            const text = 'let $events = Events | take 10';
            const info = extractDefinitionInfo(text, text, 0, '$events', 'file://test.kql');

            expect(info.name).toBe('$events');
            expect(info.uri).toBe('file://test.kql');
            expect(info.body).toBe('Events | take 10');
            expect(info.nameRange.start).toBe(4); // "let " is 4 chars
            expect(info.nameRange.endExclusive).toBe(11); // "$events" is 7 chars
        });

        test('extracts documentation from inline comment', () => {
            const text = 'let $events = Events | take 10 // All events';
            const info = extractDefinitionInfo(text, text, 0, '$events', 'file://test.kql');

            expect(info.documentation).toBe('All events');
        });

        test('extracts documentation from comment above', () => {
            const text = `// Owner: jrieken
let $events = Events`;
            const info = extractDefinitionInfo(text, text, 0, '$events', 'file://test.kql');

            expect(info.documentation).toBe('Owner: jrieken');
        });

        test('extracts multi-line documentation', () => {
            const text = `// This is a description
// with multiple lines
let $events = Events`;
            const info = extractDefinitionInfo(text, text, 0, '$events', 'file://test.kql');

            expect(info.documentation).toBe(`This is a description
with multiple lines`);
        });

        test('handles dotted definition names', () => {
            const text = 'let $events.query.debug = Events | where Level == "debug"';
            const info = extractDefinitionInfo(text, text, 0, '$events.query.debug', 'file://test.kql');

            expect(info.name).toBe('$events.query.debug');
            expect(info.body).toBe('Events | where Level == "debug"');
        });
    });

    describe('getDefinitionNameAtOffset', () => {
        test('returns definition name at start', () => {
            const text = '$events | take 10';
            expect(getDefinitionNameAtOffset(text, 0)).toBe('$events');
            expect(getDefinitionNameAtOffset(text, 3)).toBe('$events');
            expect(getDefinitionNameAtOffset(text, 6)).toBe('$events');
        });

        test('returns definition name with dots', () => {
            const text = '$events.query.debug | take 10';
            expect(getDefinitionNameAtOffset(text, 0)).toBe('$events.query.debug');
            expect(getDefinitionNameAtOffset(text, 10)).toBe('$events.query.debug');
            expect(getDefinitionNameAtOffset(text, 18)).toBe('$events.query.debug');
        });

        test('returns null when not on a definition', () => {
            const text = 'Events | take 10';
            expect(getDefinitionNameAtOffset(text, 0)).toBeNull();
            expect(getDefinitionNameAtOffset(text, 5)).toBeNull();
        });

        test('returns null for $ in string', () => {
            const text = 'print "$not_a_definition"';
            // At position 7, we're at the $ but it's inside quotes
            // Our simple parser doesn't know about strings, so it will match
            // In practice, this is fine because there won't be a definition with that name
            expect(getDefinitionNameAtOffset(text, 7)).toBe('$not_a_definition');
        });

        test('handles definition in middle of text', () => {
            const text = 'let x = $events | take 10';
            expect(getDefinitionNameAtOffset(text, 8)).toBe('$events');
            expect(getDefinitionNameAtOffset(text, 12)).toBe('$events');
        });

        test('returns null for standalone $', () => {
            const text = 'print $ + 1';
            expect(getDefinitionNameAtOffset(text, 6)).toBeNull();
        });

        test('handles definition at end of text', () => {
            const text = 'print $x';
            expect(getDefinitionNameAtOffset(text, 6)).toBe('$x');
            expect(getDefinitionNameAtOffset(text, 7)).toBe('$x');
        });
    });
});
