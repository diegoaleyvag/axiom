import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { AttemptEvaluation } from './evaluate-attempt.js';
import { runCase } from './run-case.js';

function evaluationFor(pass: boolean): AttemptEvaluation {
  return pass
    ? { passed: true, findings: [] }
    : { passed: false, findings: [{ code: 'x', category: 'json' }] };
}

describe('runCase', () => {
  it('stops at the first passing attempt and never calls the content source again', async () => {
    const calls: number[] = [];
    const outcome = await runCase(
      'case-1',
      'check-1',
      3,
      async (index) => {
        calls.push(index);
        return `attempt-${index}`;
      },
      async (content) => evaluationFor(content === 'attempt-1'),
    );

    expect(calls).toEqual([0, 1]);
    expect(outcome.passed).toBe(true);
    expect(outcome.attemptsUsed).toBe(2);
    expect(outcome.firstAttemptPassed).toBe(false);
  });

  it('exhausts maxAttempts and reports failure when nothing ever passes', async () => {
    const outcome = await runCase(
      'case-1',
      'check-1',
      3,
      async (index) => `attempt-${index}`,
      async () => evaluationFor(false),
    );

    expect(outcome.passed).toBe(false);
    expect(outcome.attemptsUsed).toBe(3);
    expect(outcome.attempts).toHaveLength(3);
  });

  it('stamps every finding with the case id, check id, and 1-based attempt number', async () => {
    const outcome = await runCase(
      'case-9',
      'check-9',
      1,
      async () => 'content',
      async () => evaluationFor(false),
    );
    expect(outcome.attempts[0]?.findings[0]).toMatchObject({
      checkId: 'check-9',
      caseId: 'case-9',
      attempt: 1,
    });
  });

  it('propagates a content-source failure immediately (a command-level fault is never retried)', async () => {
    let calls = 0;
    await expect(
      runCase(
        'case-1',
        'check-1',
        3,
        async () => {
          calls += 1;
          throw new Error('spawn failed');
        },
        async () => evaluationFor(false),
      ),
    ).rejects.toThrow('spawn failed');
    expect(calls).toBe(1);
  });

  it('firstAttemptPassed is true only when attempt 1 itself passed', async () => {
    const outcome = await runCase(
      'case-1',
      'check-1',
      1,
      async () => 'content',
      async () => evaluationFor(true),
    );
    expect(outcome.firstAttemptPassed).toBe(true);
    expect(outcome.attemptsUsed).toBe(1);
  });
});

describe('runCase: property (retry bounds)', () => {
  it('never exceeds maxAttempts, and stops at the first index whose attempt passes', () => {
    fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 5 }),
        // The 0-based index (if any) of the first attempt that would pass, or "never".
        fc.option(fc.integer({ min: 0, max: 9 }), { nil: undefined }),
        async (maxAttempts, firstPassingIndex) => {
          const calls: number[] = [];
          const outcome = await runCase(
            'case-x',
            'check-x',
            maxAttempts,
            async (index) => {
              calls.push(index);
              return String(index);
            },
            async (content) => {
              const index = Number(content);
              const passed = firstPassingIndex !== undefined && index >= firstPassingIndex;
              return passed
                ? { passed: true, findings: [] }
                : { passed: false, findings: [{ code: 'x', category: 'json' }] };
            },
          );

          // Total attempts actually taken is bounded by both the configured cap and (when a
          // pass exists within range) the first passing index.
          const expectedUsed =
            firstPassingIndex !== undefined && firstPassingIndex < maxAttempts
              ? firstPassingIndex + 1
              : maxAttempts;

          expect(outcome.attemptsUsed).toBe(expectedUsed);
          expect(outcome.attemptsUsed).toBeLessThanOrEqual(maxAttempts);
          expect(calls).toEqual(Array.from({ length: expectedUsed }, (_, i) => i));
          expect(outcome.attempts).toHaveLength(expectedUsed);

          // The loop must never call the content source again once an attempt has passed.
          const passedIndices = outcome.attempts
            .map((attempt, i) => (attempt.passed ? i : -1))
            .filter((i) => i >= 0);
          if (passedIndices.length > 0) {
            expect(passedIndices).toEqual([expectedUsed - 1]);
          }

          expect(outcome.passed).toBe(
            firstPassingIndex !== undefined && firstPassingIndex < maxAttempts,
          );
          expect(outcome.firstAttemptPassed).toBe(firstPassingIndex === 0);
          // Every finding is stamped with the exact 1-based attempt number it occurred at.
          for (const [i, attempt] of outcome.attempts.entries()) {
            for (const finding of attempt.findings) {
              expect(finding.attempt).toBe(i + 1);
            }
          }
        },
      ),
      { numRuns: 300 },
    );
  });
});
