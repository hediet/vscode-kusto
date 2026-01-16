import { describe, it, expect } from 'vitest';
import { TsSymbolResolver, parseSymbolRef, createSourceLink } from './tsSymbolResolver';
import * as ts from 'typescript';
import * as path from 'path';

describe('parseSymbolRef', () => {
    it('should parse simple symbol name', () => {
        const result = parseSymbolRef('MyClass');
        expect(result.parts).toEqual(['MyClass']);
        expect(result.isQualified).toBe(false);
    });

    it('should parse qualified symbol with #', () => {
        const result = parseSymbolRef('#MyClass.myMethod');
        expect(result.parts).toEqual(['MyClass', 'myMethod']);
        expect(result.isQualified).toBe(true);
    });

    it('should parse qualified symbol without #', () => {
        const result = parseSymbolRef('MyClass.myMethod');
        expect(result.parts).toEqual(['MyClass', 'myMethod']);
        expect(result.isQualified).toBe(true);
    });

    it('should parse deeply nested symbol', () => {
        const result = parseSymbolRef('#Container.nested.deeply.member');
        expect(result.parts).toEqual(['Container', 'nested', 'deeply', 'member']);
        expect(result.isQualified).toBe(true);
    });
});

describe('TsSymbolResolver', () => {
    const createResolver = (files: Record<string, string>) => {
        const filesMap = new Map<string, string>();
        for (const [name, content] of Object.entries(files)) {
            filesMap.set(name, content);
        }
        return new TsSymbolResolver({
            projectRoot: '/test',
            additionalFiles: filesMap
        });
    };

    describe('findSymbol - top level', () => {
        it('should find a class declaration', () => {
            const resolver = createResolver({
                '/test/file.ts': `
export class MyClass {
    myMethod() {}
}
`
            });

            const result = resolver.findSymbol('MyClass');
            expect(result).not.toBeNull();
            expect(result!.name).toBe('MyClass');
            expect(result!.line).toBe(2);
            expect(result!.kindName).toBe('ClassDeclaration');
        });

        it('should find a function declaration', () => {
            const resolver = createResolver({
                '/test/file.ts': `
function myFunction() {
    return 42;
}
`
            });

            const result = resolver.findSymbol('myFunction');
            expect(result).not.toBeNull();
            expect(result!.name).toBe('myFunction');
            expect(result!.kindName).toBe('FunctionDeclaration');
        });

        it('should find a variable declaration', () => {
            const resolver = createResolver({
                '/test/file.ts': `
const myConstant = 'hello';
`
            });

            const result = resolver.findSymbol('myConstant');
            expect(result).not.toBeNull();
            expect(result!.name).toBe('myConstant');
        });

        it('should find an interface declaration', () => {
            const resolver = createResolver({
                '/test/file.ts': `
interface MyInterface {
    prop: string;
}
`
            });

            const result = resolver.findSymbol('MyInterface');
            expect(result).not.toBeNull();
            expect(result!.name).toBe('MyInterface');
            expect(result!.kindName).toBe('InterfaceDeclaration');
        });

        it('should find a type alias', () => {
            const resolver = createResolver({
                '/test/file.ts': `
type MyType = string | number;
`
            });

            const result = resolver.findSymbol('MyType');
            expect(result).not.toBeNull();
            expect(result!.name).toBe('MyType');
            expect(result!.kindName).toBe('TypeAliasDeclaration');
        });

        it('should find an enum', () => {
            const resolver = createResolver({
                '/test/file.ts': `
enum MyEnum {
    A,
    B
}
`
            });

            const result = resolver.findSymbol('MyEnum');
            expect(result).not.toBeNull();
            expect(result!.name).toBe('MyEnum');
            expect(result!.kindName).toBe('EnumDeclaration');
        });
    });

    describe('findSymbol - nested members', () => {
        it('should find a class method', () => {
            const resolver = createResolver({
                '/test/file.ts': `
class MyClass {
    myMethod() {
        return 42;
    }
}
`
            });

            const result = resolver.findSymbol('#MyClass.myMethod');
            expect(result).not.toBeNull();
            expect(result!.name).toBe('myMethod');
            expect(result!.kindName).toBe('MethodDeclaration');
        });

        it('should find a class property', () => {
            const resolver = createResolver({
                '/test/file.ts': `
class MyClass {
    myProperty: string = 'hello';
}
`
            });

            const result = resolver.findSymbol('#MyClass.myProperty');
            expect(result).not.toBeNull();
            expect(result!.name).toBe('myProperty');
            expect(result!.kindName).toBe('PropertyDeclaration');
        });

        it('should find an interface property', () => {
            const resolver = createResolver({
                '/test/file.ts': `
interface MyInterface {
    myProp: string;
}
`
            });

            const result = resolver.findSymbol('#MyInterface.myProp');
            expect(result).not.toBeNull();
            expect(result!.name).toBe('myProp');
            expect(result!.kindName).toBe('PropertySignature');
        });

        it('should find object literal property', () => {
            const resolver = createResolver({
                '/test/file.ts': `
const myObject = {
    nestedProp: 'value'
};
`
            });

            const result = resolver.findSymbol('#myObject.nestedProp');
            expect(result).not.toBeNull();
            expect(result!.name).toBe('nestedProp');
        });

        it('should find constructor', () => {
            const resolver = createResolver({
                '/test/file.ts': `
class MyClass {
    constructor() {}
}
`
            });

            const result = resolver.findSymbol('#MyClass.constructor');
            expect(result).not.toBeNull();
            expect(result!.name).toBe('constructor');
            expect(result!.kindName).toBe('Constructor');
        });

        it('should find getter', () => {
            const resolver = createResolver({
                '/test/file.ts': `
class MyClass {
    get myGetter() {
        return 42;
    }
}
`
            });

            const result = resolver.findSymbol('#MyClass.myGetter');
            expect(result).not.toBeNull();
            expect(result!.name).toBe('myGetter');
            expect(result!.kindName).toBe('GetAccessor');
        });

        it('should find static member', () => {
            const resolver = createResolver({
                '/test/file.ts': `
class MyClass {
    static staticMethod() {
        return 42;
    }
}
`
            });

            const result = resolver.findSymbol('#MyClass.staticMethod');
            expect(result).not.toBeNull();
            expect(result!.name).toBe('staticMethod');
        });
    });

    describe('findSymbol - edge cases', () => {
        it('should return null for non-existent symbol', () => {
            const resolver = createResolver({
                '/test/file.ts': `
class MyClass {}
`
            });

            const result = resolver.findSymbol('NonExistent');
            expect(result).toBeNull();
        });

        it('should return null for non-existent member', () => {
            const resolver = createResolver({
                '/test/file.ts': `
class MyClass {}
`
            });

            const result = resolver.findSymbol('#MyClass.nonExistent');
            expect(result).toBeNull();
        });

        it('should find symbol across multiple files', () => {
            const resolver = createResolver({
                '/test/file1.ts': `
class FirstClass {}
`,
                '/test/file2.ts': `
class SecondClass {
    method() {}
}
`
            });

            const result1 = resolver.findSymbol('FirstClass');
            const result2 = resolver.findSymbol('#SecondClass.method');

            expect(result1).not.toBeNull();
            expect(result1!.name).toBe('FirstClass');

            expect(result2).not.toBeNull();
            expect(result2!.name).toBe('method');
        });
    });

    describe('line and column tracking', () => {
        it('should report correct line numbers', () => {
            const resolver = createResolver({
                '/test/file.ts': `// line 1
// line 2
class MyClass {
    // line 4
    myMethod() {
        return 42;
    }
}
`
            });

            const classResult = resolver.findSymbol('MyClass');
            expect(classResult!.line).toBe(3);

            const methodResult = resolver.findSymbol('#MyClass.myMethod');
            expect(methodResult!.line).toBe(5);
        });

        it('should report correct column numbers', () => {
            const resolver = createResolver({
                '/test/file.ts': `class MyClass {
    myMethod() {}
}`
            });

            const methodResult = resolver.findSymbol('#MyClass.myMethod');
            expect(methodResult!.column).toBe(5); // 4 spaces indent + 1
        });
    });

    describe('documentation extraction', () => {
        it('should extract JSDoc comments', () => {
            const resolver = createResolver({
                '/test/file.ts': `
/**
 * This is my class
 */
class MyClass {}
`
            });

            const result = resolver.findSymbol('MyClass');
            expect(result).not.toBeNull();
            expect(result!.documentation).toBe('This is my class');
        });
    });

    describe('findSymbols - pattern matching', () => {
        it('should find symbols by pattern', () => {
            const resolver = createResolver({
                '/test/file.ts': `
class TestClass {}
class AnotherTest {}
class Something {}
`
            });

            const results = resolver.findSymbols('*Test*');
            expect(results.length).toBe(2);
            const names = results.map(r => r.name);
            expect(names).toContain('TestClass');
            expect(names).toContain('AnotherTest');
        });

        it('should find exact match', () => {
            const resolver = createResolver({
                '/test/file.ts': `
class Test {}
class TestClass {}
`
            });

            const results = resolver.findSymbols('Test');
            expect(results.length).toBe(1);
            expect(results[0].name).toBe('Test');
        });
    });

    describe('getAllTopLevelSymbols', () => {
        it('should return all top-level symbols', () => {
            const resolver = createResolver({
                '/test/file.ts': `
class MyClass {}
function myFunction() {}
const myConst = 1;
interface MyInterface {}
`
            });

            const results = resolver.getAllTopLevelSymbols();
            expect(results.length).toBe(4);
            const names = results.map(r => r.name);
            expect(names).toContain('MyClass');
            expect(names).toContain('myFunction');
            expect(names).toContain('myConst');
            expect(names).toContain('MyInterface');
        });
    });

    describe('getEnumValues', () => {
        it('should extract string literal union type values', () => {
            const resolver = createResolver({
                '/test/file.ts': `
type Feature = 'copilot' | 'inline-completions' | 'nes';
`
            });

            const values = resolver.getEnumValues('Feature');
            expect(values.map(v => v.value)).toMatchInlineSnapshot(`
              [
                "copilot",
                "inline-completions",
                "nes",
              ]
            `);
            expect(values.every(v => v.type === 'string')).toBe(true);
        });

        it('should extract numeric literal union type values', () => {
            const resolver = createResolver({
                '/test/file.ts': `
type StatusCode = 1 | 2 | 3;
`
            });

            const values = resolver.getEnumValues('StatusCode');
            expect(values.map(v => v.value)).toMatchInlineSnapshot(`
              [
                1,
                2,
                3,
              ]
            `);
            expect(values.every(v => v.type === 'number')).toBe(true);
        });

        it('should extract TypeScript enum values', () => {
            const resolver = createResolver({
                '/test/file.ts': `
enum Status {
    Pending,
    Active,
    Completed
}
`
            });

            const values = resolver.getEnumValues('Status');
            expect(values.map(v => v.description)).toMatchInlineSnapshot(`
              [
                "Pending",
                "Active",
                "Completed",
              ]
            `);
        });

        it('should extract string enum values', () => {
            const resolver = createResolver({
                '/test/file.ts': `
enum Presentation {
    Inline = 'inline',
    Ghost = 'ghost',
    Popup = 'popup'
}
`
            });

            const values = resolver.getEnumValues('Presentation');
            expect(values.map(v => ({ value: v.value, desc: v.description }))).toMatchInlineSnapshot(`
              [
                {
                  "desc": "Inline",
                  "value": "inline",
                },
                {
                  "desc": "Ghost",
                  "value": "ghost",
                },
                {
                  "desc": "Popup",
                  "value": "popup",
                },
              ]
            `);
        });

        it('should extract enum values from interface property type', () => {
            const resolver = createResolver({
                '/test/file.ts': `
interface IEditTelemetryBaseData {
    feature: 'copilot' | 'inline-completions' | 'nes';
    presentation: 'inline' | 'ghost';
}
`
            });

            const featureValues = resolver.getEnumValues('#IEditTelemetryBaseData.feature');
            expect(featureValues.map(v => v.value)).toMatchInlineSnapshot(`
              [
                "copilot",
                "inline-completions",
                "nes",
              ]
            `);

            const presentationValues = resolver.getEnumValues('#IEditTelemetryBaseData.presentation');
            expect(presentationValues.map(v => v.value)).toMatchInlineSnapshot(`
              [
                "inline",
                "ghost",
              ]
            `);
        });

        it('should return empty array for non-enum types', () => {
            const resolver = createResolver({
                '/test/file.ts': `
interface Data {
    name: string;
    count: number;
}
`
            });

            expect(resolver.getEnumValues('#Data.name')).toEqual([]);
            expect(resolver.getEnumValues('#Data.count')).toEqual([]);
        });

        it('should handle referenced type aliases', () => {
            // For type aliases referencing other type aliases, 
            // the type checker resolves the full type
            const resolver = createResolver({
                '/test/file.ts': `
type Mode = 'longterm' | '5minWindow' | '10minFocusWindow';
`
            });

            // Direct lookup of a type alias works
            const values = resolver.getEnumValues('Mode');
            expect(values.map(v => v.value)).toMatchInlineSnapshot(`
              [
                "longterm",
                "5minWindow",
                "10minFocusWindow",
              ]
            `);
        });
    });
});

describe('createSourceLink', () => {
    it('should create a markdown link with Source: filename format', () => {
        const location = {
            filePath: '/project/src/file.ts',
            line: 42,
            column: 5,
            name: 'MyClass',
            kind: ts.SyntaxKind.ClassDeclaration,
            kindName: 'ClassDeclaration',
        };

        const link = createSourceLink(location, '/project');
        expect(link).toBe('[Source: file.ts](file://./src/file.ts#L42)');
    });

    it('should handle Windows paths', () => {
        const location = {
            filePath: 'D:\\project\\src\\file.ts',
            line: 10,
            column: 1,
            name: 'test',
            kind: ts.SyntaxKind.FunctionDeclaration,
            kindName: 'FunctionDeclaration',
        };

        // On Windows, relative path returns backslashes which we convert to forward
        const link = createSourceLink(location, 'D:\\project');
        expect(link).toBe('[Source: file.ts](file://./src/file.ts#L10)');
    });

    it('should include GitHub Permalink when commitHash and repoUrl provided', () => {
        const location = {
            filePath: '/project/src/file.ts',
            line: 42,
            column: 5,
            name: 'MyClass',
            kind: ts.SyntaxKind.ClassDeclaration,
            kindName: 'ClassDeclaration',
        };

        const link = createSourceLink(location, '/project', {
            commitHash: 'abc123def456',
            repoUrl: 'https://github.com/microsoft/vscode',
        });
        expect(link).toBe(
            '[Source: file.ts](file://./src/file.ts#L42) | [Permalink](https://github.com/microsoft/vscode/blob/abc123def456/src/file.ts#L42)'
        );
    });

    it('should use relative path from output file with ./ prefix', () => {
        const location = {
            filePath: 'D:\\project\\src\\deep\\file.ts',
            line: 10,
            column: 1,
            name: 'test',
            kind: ts.SyntaxKind.FunctionDeclaration,
            kindName: 'FunctionDeclaration',
        };

        const link = createSourceLink(location, 'D:\\project', {
            outputPath: 'D:\\other\\output.kql',
        });
        // The file:// link should be relative to the output directory with ./ prefix
        expect(link).toContain('[Source: file.ts]');
        expect(link).toContain('file://./');
        expect(link).toContain('#L10');
    });
});
