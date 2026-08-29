import type { Finding } from '../domain/report.js';

/**
 * A {@link Finding} minus the case-level fields (`checkId`/`caseId`/`attempt`) that only the
 * per-attempt evaluation loop (`./evaluate-attempt.ts`, `./run-check.ts`) knows how to fill
 * in -- every stage (`json`/`schema`/`invariant`/`policy`) only ever produces this shape.
 */
export type PartialFinding = Omit<Finding, 'checkId' | 'caseId' | 'attempt'>;
