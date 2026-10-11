import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateAction, classifyTool, redactArguments, DEFAULT_POLICY } from '../src/gate.js';
import { isValidIban, isValidRoutingNumber, passesLuhn, scanPaymentText } from '../src/payments.js';

const policyWith = (overrides) => ({ ...DEFAULT_POLICY, ...overrides });
const trustedPolicy = policyWith({
  categories: {
    ...DEFAULT_POLICY.categories,
    'outbound-mail': {
      ...DEFAULT_POLICY.categories['outbound-mail'],
      trustedDomains: ['example.com'],
    },
  },
});

const table = [
  ['search_threads', { query: 'invoice from northwind' }, 'allow', 'read-only'],
  ['gmail_get_message', { id: 'abc' }, 'allow', 'read-only'],
  ['listMessages', { labelIds: ['INBOX'] }, 'allow', 'read-only'],
  ['list_filters', {}, 'allow', 'read-only'],
  ['get_payment_status', { id: 'p1' }, 'allow', 'read-only'],
  ['send_payment', { amount: '10', to: 'vendor' }, 'approve', 'payment'],
  ['wire_transfer', {}, 'approve', 'payment'],
  ['checkout_cart', {}, 'approve', 'payment'],
  ['update_vendor', { name: 'Northwind' }, 'approve', 'payee-change'],
  ['add_beneficiary', {}, 'approve', 'payee-change'],
  [
    'send_email',
    { to: 'someone@example.org', subject: 'hi', body: 'hello' },
    'approve',
    'outbound-mail',
  ],
  ['reply_to_thread', { threadId: 't', body: 'thanks' }, 'approve', 'outbound-mail'],
  ['forward_message', { id: 'm', to: 'x@example.org' }, 'approve', 'outbound-mail'],
  ['delete_message', { id: 'm' }, 'approve', 'destructive'],
  ['trash_thread', { id: 't' }, 'approve', 'destructive'],
  ['share_file', { fileId: 'f', email: 'x@example.org' }, 'approve', 'sharing'],
  ['update_permissions', {}, 'approve', 'sharing'],
  ['create_filter', { criteria: {}, action: { forward: 'x@example.org' } }, 'deny', 'mail-rules'],
  ['set_auto_forwarding', {}, 'deny', 'mail-rules'],
  ['get_verification_code', {}, 'deny', 'credentials'],
  ['reset_password', {}, 'deny', 'credentials'],
  ['create_api_key', {}, 'deny', 'credentials'],
  ['frobnicate', {}, 'approve', 'unrecognized-write'],
  ['mark_as_read', { id: 'm' }, 'approve', 'unrecognized-write'],
  ['get_and_send_report', {}, 'approve', 'outbound-mail'],
];

for (const [tool, args, decision, category] of table) {
  test(`gate: ${tool} -> ${decision}`, () => {
    const result = evaluateAction({ tool, args });
    assert.equal(result.decision, decision, JSON.stringify(result.reasons));
    assert.equal(result.category, category);
    assert.ok(result.reasons.length > 0);
  });
}

test('unknown tools fail closed', () => {
  assert.equal(evaluateAction({ tool: '' }).decision, 'approve');
  assert.equal(evaluateAction({}).decision, 'approve');
  assert.equal(evaluateAction({ tool: 'x', args: null }).decision, 'approve');
});

test('payment details hidden inside a routine-looking tool raise to approve', () => {
  const result = evaluateAction({
    tool: 'search_notes',
    args: { query: 'please wire 4,800.00 EUR to IBAN GB82 WEST 1234 5698 7654 32 today' },
  });
  assert.equal(result.decision, 'approve');
  assert.equal(result.category, 'read-only');
  assert.ok(
    result.details.accounts.some((a) => a.type === 'iban' && a.value === 'GB82WEST12345698765432'),
  );
  assert.ok(result.details.amounts.length > 0);
  assert.ok(result.reasons.some((r) => r.includes('iban')));
});

test('payment content detectors', () => {
  const cases = [
    ['iban', 'DE89 3704 0044 0532 0130 00'],
    ['swift-bic', 'SWIFT: DEUTDEFF500'],
    ['us-routing', 'routing number 011000015 account 123456789012'],
    ['ca-bank-account', 'transit 12345 institution 004 account 1234567'],
    ['ca-bank-account', 'deposit to 12345-004-1234567'],
    ['eth-address', 'send to 0x52908400098527886E0F7030069857D2E4169EE7'],
    ['btc-address', 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq'],
  ];
  for (const [type, text] of cases) {
    assert.ok(
      scanPaymentText(text).accounts.some((a) => a.type === type),
      `${type}: ${text}`,
    );
  }
  assert.equal(scanPaymentText('Send an Interac e-Transfer to the address').interac, true);
  assert.ok(scanPaymentText('Buy three gift cards').paymentWords.includes('gift cards'));
  assert.equal(scanPaymentText('card 4111 1111 1111 1111').cardCount, 1);
});

test('payment detectors reject lookalikes', () => {
  assert.equal(isValidIban('GB82 WEST 1234 5698 7654 33'), false);
  assert.equal(isValidRoutingNumber('123456789'), false);
  assert.equal(passesLuhn('4111111111111112'), false);
  const benign = scanPaymentText('Order 123456789 shipped. PASSWORD reset. Meeting at 10:30.');
  assert.deepEqual(benign.accounts, []);
});

test('card numbers are detected but never appear in the result', () => {
  const result = evaluateAction({
    tool: 'add_note',
    args: { text: 'card 4111-1111-1111-1111 exp 12/29' },
  });
  assert.equal(result.decision, 'approve');
  assert.equal(result.details.cardNumbers, 1);
  const serialized = JSON.stringify(result);
  assert.ok(!serialized.includes('4111'), serialized);
  assert.ok(
    !JSON.stringify(redactArguments({ n: 4111111111111111, s: 'x 4111 1111 1111 1111' })).includes(
      '4111',
    ),
  );
});

test('payees.json mismatch gets a loud flag', () => {
  const payees = {
    payees: [
      {
        name: 'Northwind Supplies',
        accounts: ['DE89370400440532013000'],
        emails: ['billing@northwind.example.org'],
        domains: ['northwind.example.org'],
      },
    ],
  };
  const policy = policyWith({ payees });
  const changed = evaluateAction(
    {
      tool: 'send_payment',
      args: { payee: 'Northwind Supplies', iban: 'GB82WEST12345698765432', amount: '$900' },
    },
    policy,
  );
  assert.ok(changed.details.payeeFlags.some((f) => f.flag === 'payee-account-mismatch'));
  assert.ok(changed.reasons.some((r) => r.startsWith('WARNING')));
  const known = evaluateAction(
    {
      tool: 'send_payment',
      args: { payee: 'Northwind Supplies', iban: 'DE89 3704 0044 0532 0130 00' },
    },
    policy,
  );
  assert.equal(known.details.payeeFlags.length, 0);
  const fresh = evaluateAction(
    { tool: 'send_payment', args: { iban: 'GB82WEST12345698765432' } },
    policy,
  );
  assert.ok(fresh.details.payeeFlags.some((f) => f.flag === 'new-payment-details'));
  const email = evaluateAction(
    {
      tool: 'send_email',
      args: {
        to: 'billing@northwind-payments.example.org',
        body: 'Northwind Supplies invoice attached, wire today',
      },
    },
    policy,
  );
  assert.ok(email.details.payeeFlags.some((f) => f.flag === 'payee-email-mismatch'));
});

test('trusted domain allowlist allows internal mail without attachments only', () => {
  const internal = evaluateAction(
    { tool: 'send_email', args: { to: 'team@example.com', body: 'lunch?' } },
    trustedPolicy,
  );
  assert.equal(internal.decision, 'allow');
  const withAttachment = evaluateAction(
    { tool: 'send_email', args: { to: 'team@example.com', attachments: ['a.pdf'] } },
    trustedPolicy,
  );
  assert.equal(withAttachment.decision, 'approve');
  const external = evaluateAction(
    { tool: 'send_email', args: { to: ['team@example.com', 'x@example.org'] } },
    trustedPolicy,
  );
  assert.equal(external.decision, 'approve');
  assert.deepEqual(external.details.externalRecipients, ['x@example.org']);
  const internalMoney = evaluateAction(
    { tool: 'send_email', args: { to: 'team@example.com', body: 'please wire $5,000 now' } },
    trustedPolicy,
  );
  assert.equal(internalMoney.decision, 'approve');
});

test('session taint forces approval for writes but not reads', () => {
  const session = { tainted: true, reasons: ['get_message returned malicious content'] };
  const write = evaluateAction({ tool: 'label_message', args: { id: 'm' }, session });
  assert.equal(write.decision, 'approve');
  assert.ok(write.reasons.some((r) => r.includes('suspicious or malicious')));
  const trustedWrite = evaluateAction(
    { tool: 'send_email', args: { to: 'team@example.com' }, session },
    trustedPolicy,
  );
  assert.equal(trustedWrite.decision, 'approve');
  const read = evaluateAction({ tool: 'list_messages', args: {}, session });
  assert.equal(read.decision, 'allow');
});

test('deny wins over approve', () => {
  const result = evaluateAction({ tool: 'send_password_reset', args: { to: 'x@example.org' } });
  assert.equal(result.decision, 'deny');
  assert.equal(classifyTool('pay_with_api_key').decision, 'deny');
});

test('gate is deterministic', () => {
  const call = { tool: 'send_email', args: { to: 'x@example.org', body: 'invoice $10' } };
  assert.deepEqual(evaluateAction(call), evaluateAction(call));
});
