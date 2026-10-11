import { createHash, randomBytes } from 'node:crypto';

export function canonicalJson(value) {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const keys = Object.keys(value)
    .filter((key) => value[key] !== undefined)
    .sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

export function hashCall(tool, args) {
  return createHash('sha256')
    .update(canonicalJson({ tool, args: args ?? {} }))
    .digest('hex');
}

function newSecret() {
  return randomBytes(24).toString('base64url');
}

export function createApprovalStore({
  ttlMs = 5 * 60 * 1000,
  maxPending = 20,
  now = Date.now,
} = {}) {
  const byId = new Map();
  const byHash = new Map();

  const remove = (approval) => {
    byId.delete(approval.id);
    if (byHash.get(approval.hash) === approval) byHash.delete(approval.hash);
  };

  const refreshExpiry = (approval) => {
    if (
      (approval.status === 'pending' || approval.status === 'approved') &&
      now() > approval.expiresAt
    ) {
      approval.status = 'expired';
    }
    return approval;
  };

  const pendingCount = () =>
    [...byId.values()].filter((a) => refreshExpiry(a).status === 'pending').length;

  return {
    lookup(tool, args) {
      const approval = byHash.get(hashCall(tool, args));
      return approval ? refreshExpiry(approval) : null;
    },

    get(id) {
      const approval = byId.get(id);
      return approval ? refreshExpiry(approval) : null;
    },

    request({ tool, args, display }) {
      const hash = hashCall(tool, args);
      const existing = byHash.get(hash);
      if (existing && refreshExpiry(existing).status === 'pending')
        return { status: 'duplicate', approval: existing };
      if (pendingCount() >= maxPending) return { status: 'flooded', approval: null };
      const created = now();
      const approval = {
        id: randomBytes(9).toString('base64url'),
        hash,
        tool,
        display,
        token: newSecret(),
        csrf: newSecret(),
        status: 'pending',
        createdAt: created,
        expiresAt: created + ttlMs,
      };
      if (existing) remove(existing);
      byId.set(approval.id, approval);
      byHash.set(hash, approval);
      return { status: 'created', approval };
    },

    decide(id, decision) {
      const approval = byId.get(id);
      if (!approval || refreshExpiry(approval).status !== 'pending') return null;
      approval.status = decision === 'approve' ? 'approved' : 'rejected';
      approval.decidedAt = now();
      if (approval.status === 'approved') approval.expiresAt = approval.decidedAt + ttlMs;
      return approval;
    },

    consume(approval) {
      approval.status = 'consumed';
      remove(approval);
    },

    settle(approval) {
      remove(approval);
    },

    pending() {
      return [...byId.values()].filter((a) => refreshExpiry(a).status === 'pending');
    },
  };
}
