/**
 * Shared validation for result submissions.
 *
 * Every submission path — web form, WhatsApp bot, manual entry by a
 * coordinator — runs through validateSubmission() before it reaches the
 * database. The database re-checks everything anyway (see submit_result
 * in 01_schema.sql); this layer exists to give the agent a useful error
 * on their phone instead of a Postgres exception.
 */

export interface PartyVotes {
  [partyCode: string]: number;
}

export interface SubmissionInput {
  puId: number;
  agentId?: string | null;
  partyVotes: PartyVotes;
  rejectedVotes?: number;
  accreditedVoters?: number | null;
  ec8aPath?: string | null;
  remarks?: string | null;
  channel?: 'web' | 'whatsapp' | 'sms' | 'manual';
}

export interface ValidationIssue {
  field: string;
  message: string;
  severity: 'error' | 'warning';
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
  totalValidVotes: number;
}

const MAX_REMARKS = 1000;

/**
 * @param input            the submission as the agent entered it
 * @param registeredVoters the official figure for that polling unit
 * @param knownParties     party codes on the ballot
 */
export function validateSubmission(
  input: SubmissionInput,
  registeredVoters: number,
  knownParties: string[],
): ValidationResult {
  const issues: ValidationIssue[] = [];
  const known = new Set(knownParties.map((p) => p.toUpperCase()));

  // ---- party votes -------------------------------------------------
  const entries = Object.entries(input.partyVotes ?? {});
  if (entries.length === 0) {
    issues.push({
      field: 'partyVotes',
      message: 'Enter the votes for at least one party.',
      severity: 'error',
    });
  }

  let total = 0;
  for (const [code, votes] of entries) {
    const upper = code.toUpperCase();
    if (!known.has(upper)) {
      issues.push({
        field: `partyVotes.${code}`,
        message: `"${code}" is not a party on this ballot.`,
        severity: 'error',
      });
      continue;
    }
    if (!Number.isInteger(votes) || votes < 0) {
      issues.push({
        field: `partyVotes.${code}`,
        message: `Votes for ${upper} must be a whole number, zero or more.`,
        severity: 'error',
      });
      continue;
    }
    total += votes;
  }

  // ---- rejected votes ----------------------------------------------
  const rejected = input.rejectedVotes ?? 0;
  if (!Number.isInteger(rejected) || rejected < 0) {
    issues.push({
      field: 'rejectedVotes',
      message: 'Rejected votes must be a whole number, zero or more.',
      severity: 'error',
    });
  }

  // ---- the over-vote check, surfaced before submission -------------
  const cast = total + Math.max(rejected, 0);
  if (cast > registeredVoters) {
    issues.push({
      field: 'partyVotes',
      message:
        `Total votes (${cast}) is more than the ${registeredVoters} registered voters ` +
        `at this unit. Check the figures against the EC8A. If the form really says this, ` +
        `submit anyway and add a remark — it will be flagged for the control room.`,
      severity: 'warning',
    });
  }

  // ---- accredited voters -------------------------------------------
  if (input.accreditedVoters != null) {
    if (!Number.isInteger(input.accreditedVoters) || input.accreditedVoters < 0) {
      issues.push({
        field: 'accreditedVoters',
        message: 'Accredited voters must be a whole number, zero or more.',
        severity: 'error',
      });
    } else if (total > input.accreditedVoters) {
      issues.push({
        field: 'accreditedVoters',
        message:
          `Valid votes (${total}) is more than accredited voters ` +
          `(${input.accreditedVoters}). This will be flagged.`,
        severity: 'warning',
      });
    }
  }

  // ---- EC8A photo ---------------------------------------------------
  if (!input.ec8aPath || input.ec8aPath.trim() === '') {
    issues.push({
      field: 'ec8aPath',
      message:
        'No photo of the signed Form EC8A attached. The result can be recorded ' +
        'but cannot be verified until the photo arrives.',
      severity: 'warning',
    });
  }

  // ---- remarks -------------------------------------------------------
  if (input.remarks && input.remarks.length > MAX_REMARKS) {
    issues.push({
      field: 'remarks',
      message: `Remarks must be ${MAX_REMARKS} characters or fewer.`,
      severity: 'error',
    });
  }

  return {
    ok: !issues.some((i) => i.severity === 'error'),
    issues,
    totalValidVotes: total,
  };
}

/** Normalises Nigerian phone input to E.164. Returns null if unusable. */
export function toE164(raw: string): string | null {
  const digits = (raw ?? '').replace(/[^\d+]/g, '');
  if (/^\+234\d{10}$/.test(digits)) return digits;
  if (/^234\d{10}$/.test(digits)) return `+${digits}`;
  if (/^0\d{10}$/.test(digits)) return `+234${digits.slice(1)}`;
  if (/^\d{10}$/.test(digits)) return `+234${digits}`;
  return null;
}
