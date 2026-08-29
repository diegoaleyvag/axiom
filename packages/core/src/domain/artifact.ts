/**
 * The versioned recorded-artifact envelope (`schemas/axiom-artifact.v1.schema.json`): a
 * provider-neutral list of ordered attempts whose `content` is the raw candidate output
 * *text*, not a parsed JSON value. This is deliberate: a malformed attempt is preserved as
 * evidence (parsing it, and classifying a parse failure as a contract finding rather than
 * an envelope error, is the evaluation engine's job, implemented later) instead of being
 * rejected at the envelope level.
 *
 * A `raw` source item (see `../domain/config.js`) is not modeled here at all: it is just
 * the literal bytes of the referenced file treated as one case with exactly one attempt,
 * so there is nothing beyond the file itself to validate against a schema.
 */

export interface ArtifactAttemptV1 {
  readonly content: string;
}

export interface ArtifactEnvelopeV1 {
  readonly artifactVersion: 1;
  readonly caseId: string;
  readonly attempts: readonly ArtifactAttemptV1[];
}
