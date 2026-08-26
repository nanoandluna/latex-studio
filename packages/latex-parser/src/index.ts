export { parseLatexLog, findMainLogFile } from './errorParser.js';
export { parseBibKeys, parseBibEntries, parseLabels } from './bibParser.js';
export {
  stripComments,
  findClosingBrace,
  parseStructure,
  parseLabelOccurrences,
  parseReferenceOccurrences,
  parseCitationOccurrences,
} from './structureParser.js';
export { parseIncludes, parseGraphics, parsePackages, parseBibDirectives } from './packageParser.js';
export {
  parseTexDocument,
  parseBibDocument,
  assembleProjectIndex,
  parseEnvironments,
  parseLabelsWithKind,
  type SourceFile,
  type BibSourceFile,
  type FileParseResult,
  type BuildProjectIndexInput,
} from './projectIndex.js';
export type { LogParseResult } from './errorParser.js';
export {
  ProjectGraphQuery,
  deriveEdges,
  deriveGraphDiagnostics,
  GRAPH_SCHEMA_VERSION,
} from './graph.js';
export { analyzeTextStatistics, type TextStatsResult } from './textStats.js';
