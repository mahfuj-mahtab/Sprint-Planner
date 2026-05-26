import Client from "../models/client.models.js";
import IncomeTransaction from "../models/incomeTransaction.models.js";
import Project from "../models/project.models.js";
import { CLIENT_STATUSES, STATUS_LABELS, TYPE_LABELS } from "../constants/crmClient.js";

const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

export const isFollowUpDue = (client) => {
  if (!client.next_follow_up) return false;
  if (["past", "on_hold"].includes(client.status)) return false;
  return new Date(client.next_follow_up) <= startOfToday();
};

export const aggregateRevenueByClient = async (orgId) => {
  const rows = await IncomeTransaction.aggregate([
    { $match: { organization_id: orgId, client_id: { $ne: null } } },
    { $group: { _id: "$client_id", total: { $sum: "$amount" }, count: { $sum: 1 } } },
  ]);
  const map = {};
  for (const r of rows) {
    map[r._id.toString()] = { totalPaid: r.total, paymentCount: r.count };
  }
  return map;
};

export const buildCrmOverview = async (orgId) => {
  const [clients, revenueMap, projectCounts] = await Promise.all([
    Client.find({ organization_id: orgId }),
    aggregateRevenueByClient(orgId),
    Project.aggregate([
      { $match: { organization_id: orgId, client_id: { $ne: null } } },
      { $group: { _id: "$client_id", count: { $sum: 1 } } },
    ]),
  ]);

  const projectCountMap = Object.fromEntries(projectCounts.map((p) => [p._id.toString(), p.count]));

  let totalRevenue = 0;
  let followUpsDue = 0;
  let pipelineValue = 0;
  const byStatus = {};

  for (const c of clients) {
    const id = c._id.toString();
    const paid = revenueMap[id]?.totalPaid || 0;
    totalRevenue += paid;
    pipelineValue += Number(c.expected_value) || 0;

    byStatus[c.status] = (byStatus[c.status] || 0) + 1;
    if (isFollowUpDue(c)) followUpsDue += 1;
  }

  return {
    totalClients: clients.length,
    activeClients: (byStatus.active || 0) + (byStatus.negotiation || 0),
    leads: byStatus.lead || 0,
    followUpsDue,
    totalRevenue,
    pipelineValue,
    byStatus,
    projectCountMap,
    revenueMap,
  };
};

export const enrichClientListItem = (client, overview) => {
  const id = client._id.toString();
  const revenue = overview.revenueMap[id] || { totalPaid: 0, paymentCount: 0 };
  const obj = client.toObject ? client.toObject() : { ...client };

  const logs = obj.communicationLogs || [];
  const lastLog = logs[0];

  return {
    ...obj,
    projectCount: overview.projectCountMap[id] || 0,
    totalPaid: revenue.totalPaid,
    paymentCount: revenue.paymentCount,
    followUpDue: isFollowUpDue(obj),
    lastContactAt: obj.last_contacted_at || lastLog?.loggedAt || null,
  };
};

export const buildClientDetailSummary = (client, projects, incomes) => {
  const totalPaid = incomes.reduce((s, i) => s + Number(i.amount), 0);
  const budgetTotal = projects.reduce((s, p) => s + (Number(p.budget) || 0), 0);
  const expected = Number(client.expected_value) || 0;
  const outstanding = Math.max(0, budgetTotal - totalPaid);
  const pipelineGap = expected > 0 ? Math.max(0, expected - totalPaid) : outstanding;

  return {
    totalPaid,
    budgetTotal,
    expectedValue: expected,
    outstanding,
    pipelineGap,
    paymentCount: incomes.length,
    projectCount: projects.length,
    lastPayment: incomes[0]?.payment_date || null,
    followUpDue: isFollowUpDue(client),
  };
};

const STATUS_COLORS = {
  lead: "#fbbf24",
  active: "#00ff94",
  negotiation: "#00d4ff",
  on_hold: "#94a3b8",
  past: "#64748b",
};

const startOfMonth = (d = new Date()) => {
  const x = new Date(d);
  x.setDate(1);
  x.setHours(0, 0, 0, 0);
  return x;
};

const daysAgo = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
};

const monthLabel = (d) =>
  d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });

/** Full CRM dashboard payload for indie client pipeline. */
export const buildCrmDashboard = async (orgId) => {
  const overview = await buildCrmOverview(orgId);
  const clients = await Client.find({ organization_id: orgId }).lean();

  const clientMap = Object.fromEntries(clients.map((c) => [c._id.toString(), c]));
  const currencyFor = (clientId) => clientMap[clientId]?.currency || "BDT";

  const revenueByCurrency = {};
  const pipelineByCurrency = {};
  const byType = {};
  const byPriority = { high: 0, normal: 0, low: 0 };
  let highPriorityActive = 0;

  const monthStart = startOfMonth();
  let newClientsThisMonth = 0;

  const followUpQueue = [];
  const upcomingFollowUps = [];
  const staleContacts = [];
  const recentActivity = [];

  const endOfWeek = new Date();
  endOfWeek.setDate(endOfWeek.getDate() + 7);
  endOfWeek.setHours(23, 59, 59, 999);

  for (const c of clients) {
    const cur = c.currency || "BDT";
    const id = c._id.toString();
    const paid = overview.revenueMap[id]?.totalPaid || 0;

    revenueByCurrency[cur] = (revenueByCurrency[cur] || 0) + paid;
    pipelineByCurrency[cur] = (pipelineByCurrency[cur] || 0) + (Number(c.expected_value) || 0);

    byType[c.client_type || "prospect"] = (byType[c.client_type || "prospect"] || 0) + 1;
    const pri = c.priority || "normal";
    byPriority[pri] = (byPriority[pri] || 0) + 1;

    if (c.priority === "high" && !["past", "on_hold"].includes(c.status)) {
      highPriorityActive += 1;
    }

    if (c.createdAt && new Date(c.createdAt) >= monthStart) newClientsThisMonth += 1;

    if (isFollowUpDue(c)) {
      followUpQueue.push({
        _id: c._id,
        name: c.name,
        company: c.company || "",
        status: c.status,
        next_follow_up: c.next_follow_up,
        priority: c.priority,
        currency: cur,
      });
    } else if (
      c.next_follow_up &&
      !["past", "on_hold"].includes(c.status) &&
      new Date(c.next_follow_up) > startOfToday() &&
      new Date(c.next_follow_up) <= endOfWeek
    ) {
      upcomingFollowUps.push({
        _id: c._id,
        name: c.name,
        company: c.company || "",
        status: c.status,
        next_follow_up: c.next_follow_up,
        currency: cur,
      });
    }

    if (!["past", "on_hold"].includes(c.status)) {
      const lastAt = c.last_contacted_at
        ? new Date(c.last_contacted_at)
        : (c.communicationLogs?.[0]?.loggedAt
            ? new Date(c.communicationLogs[0].loggedAt)
            : null);
      if (!lastAt || lastAt < daysAgo(30)) {
        staleContacts.push({
          _id: c._id,
          name: c.name,
          status: c.status,
          lastContactAt: lastAt,
          daysSince: lastAt
            ? Math.floor((Date.now() - lastAt.getTime()) / 86400000)
            : null,
        });
      }
    }

    for (const log of c.communicationLogs || []) {
      recentActivity.push({
        clientId: c._id,
        clientName: c.name,
        type: log.type,
        note: log.note,
        loggedAt: log.loggedAt,
      });
    }
  }

  followUpQueue.sort(
    (a, b) => new Date(a.next_follow_up) - new Date(b.next_follow_up)
  );
  upcomingFollowUps.sort(
    (a, b) => new Date(a.next_follow_up) - new Date(b.next_follow_up)
  );
  staleContacts.sort((a, b) => (b.daysSince ?? 9999) - (a.daysSince ?? 9999));
  recentActivity.sort((a, b) => new Date(b.loggedAt) - new Date(a.loggedAt));

  const topClients = clients
    .map((c) => {
      const id = c._id.toString();
      const totalPaid = overview.revenueMap[id]?.totalPaid || 0;
      return {
        _id: c._id,
        name: c.name,
        status: c.status,
        totalPaid,
        expectedValue: Number(c.expected_value) || 0,
        currency: c.currency || "BDT",
        projectCount: overview.projectCountMap[id] || 0,
      };
    })
    .filter((c) => c.totalPaid > 0 || c.expectedValue > 0)
    .sort((a, b) => b.totalPaid - a.totalPaid || b.expectedValue - a.expectedValue)
    .slice(0, 8);

  const statusChart = CLIENT_STATUSES.map((s) => ({
    name: STATUS_LABELS[s] || s,
    value: overview.byStatus[s] || 0,
    color: STATUS_COLORS[s],
  }));

  const typeChart = Object.entries(byType).map(([key, value]) => ({
    name: TYPE_LABELS[key] || key,
    value,
  }));

  const priorityChart = [
    { name: "High", value: byPriority.high || 0 },
    { name: "Normal", value: byPriority.normal || 0 },
    { name: "Low", value: byPriority.low || 0 },
  ];

  const sixMonthsAgo = startOfMonth();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5);

  const incomes = await IncomeTransaction.find({
    organization_id: orgId,
    client_id: { $ne: null },
    payment_date: { $gte: sixMonthsAgo },
  })
    .select("amount payment_date client_id")
    .lean();

  const revenueThisMonthByCurrency = {};
  const trendBuckets = {};

  for (const inc of incomes) {
    const cur = currencyFor(inc.client_id?.toString());
    const amt = Number(inc.amount) || 0;
    const pd = new Date(inc.payment_date);

    if (pd >= monthStart) {
      revenueThisMonthByCurrency[cur] = (revenueThisMonthByCurrency[cur] || 0) + amt;
    }

    const key = `${pd.getFullYear()}-${String(pd.getMonth() + 1).padStart(2, "0")}`;
    if (!trendBuckets[cur]) trendBuckets[cur] = {};
    trendBuckets[cur][key] = (trendBuckets[cur][key] || 0) + amt;
  }

  const buildTrend = (cur) => {
    const buckets = trendBuckets[cur] || {};
    const rows = [];
    for (let i = 5; i >= 0; i -= 1) {
      const d = startOfMonth();
      d.setMonth(d.getMonth() - i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      rows.push({
        label: monthLabel(d),
        amount: buckets[key] || 0,
      });
    }
    return rows;
  };

  const revenueTrendByCurrency = Object.keys(trendBuckets).map((currency) => ({
    currency,
    data: buildTrend(currency),
  }));

  const primaryCurrency =
    Object.entries(revenueByCurrency).sort((a, b) => b[1] - a[1])[0]?.[0] ||
    clients[0]?.currency ||
    "BDT";

  return {
    summary: {
      totalClients: overview.totalClients,
      leads: overview.leads,
      activeClients: overview.activeClients,
      onHold: overview.byStatus.on_hold || 0,
      pastClients: overview.byStatus.past || 0,
      followUpsDue: overview.followUpsDue,
      highPriorityActive,
      newClientsThisMonth,
    },
    revenueByCurrency,
    pipelineByCurrency,
    revenueThisMonthByCurrency,
    primaryCurrency,
    revenueTrend:
      revenueTrendByCurrency.find((t) => t.currency === primaryCurrency)?.data ||
      buildTrend(primaryCurrency),
    revenueTrendByCurrency,
    statusChart,
    typeChart,
    priorityChart,
    topClients,
    followUpQueue: followUpQueue.slice(0, 12),
    upcomingFollowUps: upcomingFollowUps.slice(0, 8),
    staleContacts: staleContacts.slice(0, 10),
    recentActivity: recentActivity.slice(0, 20),
  };
};
