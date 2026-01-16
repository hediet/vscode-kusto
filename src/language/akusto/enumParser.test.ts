import { describe, expect, it } from 'vitest';
import { detectComparisonContext, extractEnumVariants } from './enumParser';

describe('extractEnumVariants', () => {
  it('extracts enum variants with descriptions', () => {
    const doc = `status code
@enum-variant "pending" Is still pending
@enum-variant "active" Currently active`;
    expect(extractEnumVariants(doc)).toMatchInlineSnapshot(`
          [
            {
              "description": "Is still pending",
              "value": "pending",
            },
            {
              "description": "Currently active",
              "value": "active",
            },
          ]
        `);
  });

  it('handles variant without description', () => {
    const doc = '@enum-variant "value"';
    expect(extractEnumVariants(doc)).toMatchInlineSnapshot(`
          [
            {
              "value": "value",
            },
          ]
        `);
  });

  it('handles mixed variants with and without descriptions', () => {
    const doc = `@enum-variant "a" Has description
@enum-variant "b"
@enum-variant "c" Also has one`;
    expect(extractEnumVariants(doc)).toMatchInlineSnapshot(`
          [
            {
              "description": "Has description",
              "value": "a",
            },
            {
              "value": "b",
            },
            {
              "description": "Also has one",
              "value": "c",
            },
          ]
        `);
  });

  it('returns null for no @enum-variant annotation', () => {
    const doc = 'Just a regular documentation string';
    expect(extractEnumVariants(doc)).toBeNull();
  });

  it('returns null for null/undefined documentation', () => {
    expect(extractEnumVariants(null)).toBeNull();
    expect(extractEnumVariants(undefined)).toBeNull();
    expect(extractEnumVariants('')).toBeNull();
  });

  it('handles values with spaces', () => {
    const doc = '@enum-variant "hello world" A greeting';
    expect(extractEnumVariants(doc)).toMatchInlineSnapshot(`
          [
            {
              "description": "A greeting",
              "value": "hello world",
            },
          ]
        `);
  });

  it('handles multiline documentation format', () => {
    const doc = `The status column
@enum-variant "pending" Waiting to be processed
@enum-variant "active" Currently being processed
@enum-variant "completed" Done`;
    expect(extractEnumVariants(doc)).toMatchInlineSnapshot(`
          [
            {
              "description": "Waiting to be processed",
              "value": "pending",
            },
            {
              "description": "Currently being processed",
              "value": "active",
            },
            {
              "description": "Done",
              "value": "completed",
            },
          ]
        `);
  });
});

describe('detectComparisonContext', () => {
  it('detects simple comparison', () => {
    const text = 'mode == "';
    expect(detectComparisonContext(text, text.length)).toMatchInlineSnapshot(`
          {
            "identifier": "mode",
            "identifierOffset": 0,
            "typedPrefix": "",
            "valueOffset": 9,
          }
        `);
  });

  it('detects comparison with typed prefix', () => {
    const text = 'status == "pend';
    expect(detectComparisonContext(text, text.length)).toMatchInlineSnapshot(`
          {
            "identifier": "status",
            "identifierOffset": 0,
            "typedPrefix": "pend",
            "valueOffset": 11,
          }
        `);
  });

  it('detects comparison with whitespace', () => {
    const text = 'foo   ==   "bar';
    expect(detectComparisonContext(text, text.length)).toMatchInlineSnapshot(`
          {
            "identifier": "foo",
            "identifierOffset": 0,
            "typedPrefix": "bar",
            "valueOffset": 12,
          }
        `);
  });

  it('detects comparison in larger context', () => {
    const text = 'T | where mode == "deb';
    expect(detectComparisonContext(text, text.length)).toMatchInlineSnapshot(`
          {
            "identifier": "mode",
            "identifierOffset": 10,
            "typedPrefix": "deb",
            "valueOffset": 19,
          }
        `);
  });

  it('returns null when not in a string', () => {
    const text = 'mode == ';
    expect(detectComparisonContext(text, text.length)).toBeNull();
  });

  it('returns null when no == operator', () => {
    const text = 'mode = "foo';
    expect(detectComparisonContext(text, text.length)).toBeNull();
  });

  it('returns null when not an identifier', () => {
    const text = '123 == "foo';
    expect(detectComparisonContext(text, text.length)).toBeNull();
  });

  it('handles underscore identifiers', () => {
    const text = '_my_column == "val';
    expect(detectComparisonContext(text, text.length)).toMatchInlineSnapshot(`
          {
            "identifier": "_my_column",
            "identifierOffset": 0,
            "typedPrefix": "val",
            "valueOffset": 15,
          }
        `);
  });

  it('returns null after closing quote', () => {
    const text = 'mode == "done"';
    expect(detectComparisonContext(text, text.length)).toBeNull();
  });

  it('handles newline between operator and quote', () => {
    // KQL can span multiple lines, so this is valid
    const text = 'mode ==\n"foo';
    expect(detectComparisonContext(text, text.length)).toMatchInlineSnapshot(`
          {
            "identifier": "mode",
            "identifierOffset": 0,
            "typedPrefix": "foo",
            "valueOffset": 9,
          }
        `);
  });

  it('cursor in middle of typed prefix', () => {
    const text = 'mode == "debug"';
    const cursor = text.indexOf('ug"'); // right before 'ug"'
    expect(detectComparisonContext(text, cursor)).toMatchInlineSnapshot(`
          {
            "identifier": "mode",
            "identifierOffset": 0,
            "typedPrefix": "deb",
            "valueOffset": 9,
          }
        `);
  });
});
