import { validateSubmission, toE164 } from './validation.ts';

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) {
    console.log(`  ok   ${name}`);
  } else {
    console.log(`  FAIL ${name} ${detail}`);
    failures++;
  }
}

const BALLOT = ['APC', 'PDP', 'LP', 'ADC', 'NNPP'];

console.log('validateSubmission');

// clean submission
{
  const r = validateSubmission(
    { puId: 1, partyVotes: { APC: 200, PDP: 100 }, rejectedVotes: 5, ec8aPath: 'ec8a/x.jpg' },
    500,
    BALLOT,
  );
  check('accepts a clean submission', r.ok);
  check('sums the party votes', r.totalValidVotes === 300, `got ${r.totalValidVotes}`);
  check('raises no issues', r.issues.length === 0, JSON.stringify(r.issues));
}

// over-vote
{
  const r = validateSubmission(
    { puId: 1, partyVotes: { APC: 280, PDP: 40 }, rejectedVotes: 3, ec8aPath: 'x.jpg' },
    300,
    BALLOT,
  );
  check('still submittable when over-voted', r.ok);
  check(
    'warns on over-vote',
    r.issues.some((i) => i.severity === 'warning' && i.message.includes('more than the 300')),
  );
}

// unknown party
{
  const r = validateSubmission({ puId: 1, partyVotes: { XYZ: 10 }, ec8aPath: 'x.jpg' }, 500, BALLOT);
  check('rejects an unknown party', !r.ok);
}

// negative votes
{
  const r = validateSubmission({ puId: 1, partyVotes: { APC: -5 }, ec8aPath: 'x.jpg' }, 500, BALLOT);
  check('rejects negative votes', !r.ok);
}

// non-integer
{
  const r = validateSubmission({ puId: 1, partyVotes: { APC: 10.5 }, ec8aPath: 'x.jpg' }, 500, BALLOT);
  check('rejects fractional votes', !r.ok);
}

// empty ballot
{
  const r = validateSubmission({ puId: 1, partyVotes: {}, ec8aPath: 'x.jpg' }, 500, BALLOT);
  check('rejects an empty submission', !r.ok);
}

// missing EC8A -> warning, not a blocker
{
  const r = validateSubmission({ puId: 1, partyVotes: { APC: 10 } }, 500, BALLOT);
  check('allows submission without EC8A', r.ok);
  check(
    'warns about the missing EC8A',
    r.issues.some((i) => i.field === 'ec8aPath' && i.severity === 'warning'),
  );
}

// valid votes above accredited
{
  const r = validateSubmission(
    { puId: 1, partyVotes: { APC: 200 }, accreditedVoters: 150, ec8aPath: 'x.jpg' },
    500,
    BALLOT,
  );
  check(
    'warns when valid votes exceed accredited',
    r.issues.some((i) => i.field === 'accreditedVoters' && i.severity === 'warning'),
  );
}

// remarks too long
{
  const r = validateSubmission(
    { puId: 1, partyVotes: { APC: 10 }, remarks: 'x'.repeat(1001), ec8aPath: 'x.jpg' },
    500,
    BALLOT,
  );
  check('rejects over-long remarks', !r.ok);
}

// lowercase party codes accepted
{
  const r = validateSubmission({ puId: 1, partyVotes: { apc: 50 }, ec8aPath: 'x.jpg' }, 500, BALLOT);
  check('accepts lowercase party codes', r.ok);
  check('counts them', r.totalValidVotes === 50);
}

console.log('\ntoE164');
check('0803 form', toE164('08031234567') === '+2348031234567', String(toE164('08031234567')));
check('234 form', toE164('2348031234567') === '+2348031234567');
check('+234 form', toE164('+2348031234567') === '+2348031234567');
check('bare 10 digits', toE164('8031234567') === '+2348031234567');
check('spaces and dashes', toE164('0803-123 4567') === '+2348031234567');
check('rejects nonsense', toE164('12') === null);

console.log(failures === 0 ? '\n=== ALL TESTS PASSED ===' : `\n=== ${failures} FAILURE(S) ===`);
process.exit(failures === 0 ? 0 : 1);
