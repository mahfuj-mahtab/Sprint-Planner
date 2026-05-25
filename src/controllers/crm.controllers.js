import Client from "../models/client.models.js";
import Project from "../models/project.models.js";
import IncomeTransaction from "../models/incomeTransaction.models.js";
import { getOrgForMember, assertOrgOwner } from "../utils/orgAccess.js";

const handleError = (res, error) => {
  const status = error.status || 500;
  return res.status(status).json({
    message: error.message || "Request failed",
    success: false,
    error: status === 500 ? error : undefined,
  });
};

export const clientList = async (req, res) => {
  const { orgId } = req.params;
  try {
    await getOrgForMember(orgId, req.user._id);
    const clients = await Client.find({ organization_id: orgId }).sort({ createdAt: -1 });

    const projectCounts = await Project.aggregate([
      { $match: { organization_id: orgId, client_id: { $ne: null } } },
      { $group: { _id: "$client_id", count: { $sum: 1 } } },
    ]);
    const countMap = Object.fromEntries(projectCounts.map((p) => [p._id.toString(), p.count]));

    const enriched = clients.map((c) => ({
      ...c.toObject(),
      projectCount: countMap[c._id.toString()] || 0,
    }));

    return res.status(200).json({
      message: "Clients retrieved",
      success: true,
      clients: enriched,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

export const clientCreate = async (req, res) => {
  const { orgId } = req.params;
  const { name, email, phone, company, notes } = req.body;

  if (!name?.trim()) {
    return res.status(400).json({ message: "Client name is required", success: false });
  }

  try {
    await getOrgForMember(orgId, req.user._id);
    const client = new Client({
      organization_id: orgId,
      name: name.trim(),
      email: (email || "").trim(),
      phone: (phone || "").trim(),
      company: (company || "").trim(),
      notes: (notes || "").trim(),
    });
    await client.save();
    return res.status(201).json({ message: "Client created", success: true, client });
  } catch (error) {
    return handleError(res, error);
  }
};

export const clientGet = async (req, res) => {
  const { orgId, clientId } = req.params;
  try {
    await getOrgForMember(orgId, req.user._id);
    const client = await Client.findOne({ _id: clientId, organization_id: orgId });
    if (!client) {
      return res.status(404).json({ message: "Client not found", success: false });
    }

    const projects = await Project.find({ organization_id: orgId, client_id: clientId }).sort({ createdAt: -1 });
    const incomes = await IncomeTransaction.find({ organization_id: orgId, client_id: clientId })
      .sort({ payment_date: -1 })
      .limit(50);

    const totalPaid = incomes.reduce((s, i) => s + Number(i.amount), 0);
    const pendingAmount = projects.reduce((s, p) => {
      const budget = Number(p.budget) || 0;
      return s + Math.max(0, budget - totalPaid);
    }, 0);

    return res.status(200).json({
      message: "Client details retrieved",
      success: true,
      client,
      projects,
      incomes,
      summary: { totalPaid, pendingAmount },
    });
  } catch (error) {
    return handleError(res, error);
  }
};

export const clientUpdate = async (req, res) => {
  const { orgId, clientId } = req.params;
  const { name, email, phone, company, notes } = req.body;

  try {
    await getOrgForMember(orgId, req.user._id);
    const client = await Client.findOne({ _id: clientId, organization_id: orgId });
    if (!client) {
      return res.status(404).json({ message: "Client not found", success: false });
    }

    if (name) client.name = name.trim();
    if (typeof email === "string") client.email = email.trim();
    if (typeof phone === "string") client.phone = phone.trim();
    if (typeof company === "string") client.company = company.trim();
    if (typeof notes === "string") client.notes = notes.trim();

    await client.save();
    return res.status(200).json({ message: "Client updated", success: true, client });
  } catch (error) {
    return handleError(res, error);
  }
};

export const clientDelete = async (req, res) => {
  const { orgId, clientId } = req.params;
  try {
    await assertOrgOwner(orgId, req.user._id);
    const client = await Client.findOneAndDelete({ _id: clientId, organization_id: orgId });
    if (!client) {
      return res.status(404).json({ message: "Client not found", success: false });
    }
    await Project.updateMany({ client_id: clientId }, { $set: { client_id: null } });
    return res.status(200).json({ message: "Client deleted", success: true });
  } catch (error) {
    return handleError(res, error);
  }
};

export const clientAddLog = async (req, res) => {
  const { orgId, clientId } = req.params;
  const { note } = req.body;

  if (!note?.trim()) {
    return res.status(400).json({ message: "Note is required", success: false });
  }

  try {
    await getOrgForMember(orgId, req.user._id);
    const client = await Client.findOne({ _id: clientId, organization_id: orgId });
    if (!client) {
      return res.status(404).json({ message: "Client not found", success: false });
    }

    client.communicationLogs.unshift({ note: note.trim(), loggedAt: new Date() });
    await client.save();
    return res.status(201).json({ message: "Log added", success: true, client });
  } catch (error) {
    return handleError(res, error);
  }
};
