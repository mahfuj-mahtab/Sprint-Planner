export const memberUserId = (m) => {
  if (!m?.user) return null;
  const u = m.user;
  if (u._id) return u._id.toString();
  return u.toString();
};

export const getMemberClientAccountIds = (member) => {
  if (!member) return [];
  const fromArray = (member.client_account_ids || []).map((id) => id.toString());
  const legacy = member.client_account_id ? [member.client_account_id.toString()] : [];
  return [...new Set([...fromArray, ...legacy])];
};

export const memberHasClientAccount = (member, clientAccountId) =>
  getMemberClientAccountIds(member).includes(clientAccountId?.toString());
