import { TsSymbolResolver } from './tsSymbolResolver';
import * as path from 'path';

const vscodePath = 'D:/dev/microsoft/vscode';
const tsconfigPath = path.join(vscodePath, 'src', 'tsconfig.json');

console.log('Creating resolver...');
const resolver = new TsSymbolResolver({ projectRoot: vscodePath, tsconfigPath });
console.log('Building index...');
resolver.buildStringLiteralIndex();

// Test the regex pattern
const SYMBOL_REF_REGEX = /#([A-Z][A-Za-z0-9]*(?:\.[a-zA-Z][A-Za-z0-9]*)*)/g;
const testComment = "How the code suggestion is presented to the user. See #IEditTelemetryBaseData.presentation for possible values.";
console.log('\n--- Test regex matching ---');
console.log('Comment:', testComment);
const matches = [...testComment.matchAll(SYMBOL_REF_REGEX)];
console.log('Matches:', matches);

// Try to find the symbol
const symbolRef = '#IEditTelemetryBaseData.presentation';
console.log('\nLooking for:', symbolRef);

const location = resolver.findSymbol(symbolRef);
console.log('Location:', location);

// Try to get enum values
const enumValues = resolver.getEnumValues(symbolRef);
console.log('Enum values:', JSON.stringify(enumValues, null, 2));

// Also try finding the interface itself
console.log('\n--- Finding interface ---');
const interfaceLocation = resolver.findSymbol('#IEditTelemetryBaseData');
console.log('Interface location:', interfaceLocation);
