import { SourceMap1To1 } from '../common/sourceMap1To1';
import { Instruction } from './ast';

/** Virtual TypeScript document for a single instruction. */
export class InstructionVirtualDocument {
    constructor(
        /** The complete virtual TypeScript content. */
        public readonly text: string,
        /** Maps between source and virtual positions. */
        public readonly sourceMap: SourceMap1To1
    ) { }
}

/** Build a virtual TypeScript document for an instruction. */
export function buildInstructionVirtualDocument(
    instruction: Instruction,
    typeDefinitions: string
): InstructionVirtualDocument {
    const targetOffset = typeDefinitions.length;
    const text = typeDefinitions + instruction.expression + ';';
    const sourceMap = new SourceMap1To1(instruction.expressionRange, targetOffset);
    return new InstructionVirtualDocument(text, sourceMap);
}
