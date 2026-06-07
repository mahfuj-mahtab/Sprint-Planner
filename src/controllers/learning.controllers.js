import LearningTopic from "../models/learningTopic.models.js";
import LearningAssignment from "../models/learningAssignment.models.js";
import User from "../models/users.models.js";
import { getOrgForMember, assertCanWriteOrg } from "../utils/orgAccess.js";
import {
  isValidLearningTopicStatus,
  normalizeLearningTopicStatus,
} from "../constants/learningWorkflow.js";

const serializeTopic = (doc) => {
  const obj = typeof doc.toObject === "function" ? doc.toObject() : { ...doc };
  obj.status = normalizeLearningTopicStatus(obj.status);
  return obj;
};

const handleError = (res, error) => {
  const status = error.status || 500;
  return res.status(status).json({
    message: error.message || "Request failed",
    success: false,
    error: status === 500 ? error : undefined,
  });
};

const parseDate = (value) => {
  if (value === null || value === "") return null;
  if (!value) return undefined;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    const err = new Error("Invalid date");
    err.status = 400;
    throw err;
  }
  return d;
};

const deriveAssignmentStatus = (assignment, now = new Date()) => {
  if (assignment.status === "completed" || assignment.progress_percent >= 100) {
    return "completed";
  }
  const due = assignment.due_date ? new Date(assignment.due_date) : null;
  if (due && due < now && assignment.progress_percent < 100) {
    return "overdue";
  }
  if (assignment.progress_percent > 0) return "in_progress";
  return assignment.status === "overdue" ? "not_started" : assignment.status || "not_started";
};

const enrichAssignment = (doc) => {
  const obj = typeof doc.toObject === "function" ? doc.toObject() : { ...doc };
  obj.status = deriveAssignmentStatus(obj);
  return obj;
};

const topicProgress = (assignments) => {
  if (!assignments.length) return { avg_progress: 0, completed: 0, total: 0 };
  const total = assignments.length;
  const completed = assignments.filter((a) => a.status === "completed").length;
  const avg =
    assignments.reduce((sum, a) => sum + Number(a.progress_percent || 0), 0) / total;
  return { avg_progress: Math.round(avg), completed, total };
};

const assertActiveMember = async (orgId, userId) => {
  const user = await User.findById(userId).select("name email");
  if (!user) {
    const err = new Error("User not found");
    err.status = 404;
    throw err;
  }
  await getOrgForMember(orgId, userId);
  return user;
};

export const learningOverview = async (req, res) => {
  const { orgId } = req.params;
  try {
    const { access } = await getOrgForMember(orgId, req.user._id);
    const topics = await LearningTopic.find({ organization_id: orgId }).sort({
      sort_order: 1,
      createdAt: 1,
    });
    const assignments = await LearningAssignment.find({ organization_id: orgId })
      .populate("user_id", "name email")
      .populate("assigned_by", "name email");

    const byTopic = {};
    for (const a of assignments) {
      const tid = a.topic_id.toString();
      if (!byTopic[tid]) byTopic[tid] = [];
      byTopic[tid].push(enrichAssignment(a));
    }

    const enrichedTopics = topics.map((t) => {
      const list = byTopic[t._id.toString()] || [];
      return {
        ...serializeTopic(t),
        assignments: list,
        progress: topicProgress(list),
      };
    });

    const allAssignments = enrichedTopics.flatMap((t) => t.assignments);
    const myAssignments = allAssignments.filter(
      (a) => a.user_id?._id?.toString() === req.user._id.toString()
    );

    const normalizedTopics = topics.map(serializeTopic);

    return res.status(200).json({
      success: true,
      topics: enrichedTopics,
      summary: {
        topic_count: topics.length,
        active_topics: normalizedTopics.filter((t) =>
          ["learning", "review"].includes(t.status)
        ).length,
        assignment_count: allAssignments.length,
        completed_assignments: allAssignments.filter((a) => a.status === "completed").length,
        my_assignments: myAssignments.length,
        my_completed: myAssignments.filter((a) => a.status === "completed").length,
      },
      access,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

export const topicCreate = async (req, res) => {
  const { orgId } = req.params;
  const { title, description, status, start_date, due_date } = req.body;
  try {
    await assertCanWriteOrg(orgId, req.user._id);
    if (!title?.trim()) {
      return res.status(400).json({ message: "Title is required", success: false });
    }
    const maxOrder = await LearningTopic.findOne({ organization_id: orgId })
      .sort({ sort_order: -1 })
      .select("sort_order");
    const topic = await LearningTopic.create({
      organization_id: orgId,
      title: title.trim(),
      description: (description || "").trim(),
      status:
        status && isValidLearningTopicStatus(status)
          ? normalizeLearningTopicStatus(status)
          : "pending",
      sort_order: Number(maxOrder?.sort_order || 0) + 1,
      start_date: parseDate(start_date) ?? null,
      due_date: parseDate(due_date) ?? null,
      created_by: req.user._id,
    });
    return res.status(201).json({ success: true, topic: serializeTopic(topic) });
  } catch (error) {
    return handleError(res, error);
  }
};

export const topicUpdate = async (req, res) => {
  const { orgId, topicId } = req.params;
  const body = req.body;
  try {
    await assertCanWriteOrg(orgId, req.user._id);
    const topic = await LearningTopic.findOne({ _id: topicId, organization_id: orgId });
    if (!topic) {
      return res.status(404).json({ message: "Topic not found", success: false });
    }
    if (body.title !== undefined) topic.title = String(body.title).trim();
    if (body.description !== undefined) topic.description = String(body.description).trim();
    if (body.status !== undefined) {
      if (!isValidLearningTopicStatus(body.status)) {
        return res.status(400).json({ message: "Invalid status", success: false });
      }
      topic.status = normalizeLearningTopicStatus(body.status);
    }
    if (body.start_date !== undefined) topic.start_date = parseDate(body.start_date);
    if (body.due_date !== undefined) topic.due_date = parseDate(body.due_date);
    await topic.save();
    return res.status(200).json({ success: true, topic: serializeTopic(topic) });
  } catch (error) {
    return handleError(res, error);
  }
};

export const topicDelete = async (req, res) => {
  const { orgId, topicId } = req.params;
  try {
    await assertCanWriteOrg(orgId, req.user._id);
    const topic = await LearningTopic.findOneAndDelete({ _id: topicId, organization_id: orgId });
    if (!topic) {
      return res.status(404).json({ message: "Topic not found", success: false });
    }
    await LearningAssignment.deleteMany({ topic_id: topicId, organization_id: orgId });
    return res.status(200).json({ success: true, message: "Topic deleted" });
  } catch (error) {
    return handleError(res, error);
  }
};

export const topicReorder = async (req, res) => {
  const { orgId } = req.params;
  const { orderedIds } = req.body;
  try {
    await assertCanWriteOrg(orgId, req.user._id);
    if (!Array.isArray(orderedIds) || !orderedIds.length) {
      return res.status(400).json({ message: "orderedIds array is required", success: false });
    }
    await Promise.all(
      orderedIds.map((id, index) =>
        LearningTopic.updateOne(
          { _id: id, organization_id: orgId },
          { $set: { sort_order: index + 1 } }
        )
      )
    );
    return res.status(200).json({ success: true, message: "Topics reordered" });
  } catch (error) {
    return handleError(res, error);
  }
};

export const assignmentCreate = async (req, res) => {
  const { orgId, topicId } = req.params;
  const { user_id, start_date, due_date, notes } = req.body;
  try {
    await assertCanWriteOrg(orgId, req.user._id);
    const topic = await LearningTopic.findOne({ _id: topicId, organization_id: orgId });
    if (!topic) {
      return res.status(404).json({ message: "Topic not found", success: false });
    }
    if (!user_id) {
      return res.status(400).json({ message: "user_id is required", success: false });
    }
    await assertActiveMember(orgId, user_id);

    const existing = await LearningAssignment.findOne({
      organization_id: orgId,
      topic_id: topicId,
      user_id,
    });
    if (existing) {
      return res.status(409).json({ message: "Member already assigned to this topic", success: false });
    }

    const assignment = await LearningAssignment.create({
      organization_id: orgId,
      topic_id: topicId,
      user_id,
      start_date: parseDate(start_date) ?? topic.start_date ?? null,
      due_date: parseDate(due_date) ?? topic.due_date ?? null,
      notes: (notes || "").trim(),
      assigned_by: req.user._id,
    });
    const populated = await LearningAssignment.findById(assignment._id)
      .populate("user_id", "name email")
      .populate("assigned_by", "name email");
    return res.status(201).json({ success: true, assignment: enrichAssignment(populated) });
  } catch (error) {
    return handleError(res, error);
  }
};

export const assignmentUpdate = async (req, res) => {
  const { orgId, assignmentId } = req.params;
  const body = req.body;
  try {
    const assignment = await LearningAssignment.findOne({
      _id: assignmentId,
      organization_id: orgId,
    });
    if (!assignment) {
      return res.status(404).json({ message: "Assignment not found", success: false });
    }

    const isAssignee = assignment.user_id.toString() === req.user._id.toString();
    const isManager = async () => {
      try {
        await assertCanWriteOrg(orgId, req.user._id);
        return true;
      } catch {
        return false;
      }
    };
    const canManage = await isManager();

    if (!canManage && !isAssignee) {
      return res.status(403).json({ message: "You cannot update this assignment", success: false });
    }

    if (canManage) {
      if (body.start_date !== undefined) assignment.start_date = parseDate(body.start_date);
      if (body.due_date !== undefined) assignment.due_date = parseDate(body.due_date);
      if (typeof body.notes === "string") assignment.notes = body.notes.trim();
    }

    if (body.progress_percent !== undefined) {
      const pct = Math.min(100, Math.max(0, Number(body.progress_percent) || 0));
      assignment.progress_percent = pct;
      if (pct >= 100) {
        assignment.status = "completed";
        assignment.completed_at = new Date();
      } else {
        assignment.completed_at = null;
        assignment.status = pct > 0 ? "in_progress" : "not_started";
      }
    } else if (body.status !== undefined && canManage) {
      assignment.status = body.status;
      if (body.status === "completed") {
        assignment.progress_percent = 100;
        assignment.completed_at = new Date();
      }
    }

    assignment.status = deriveAssignmentStatus(assignment);
    await assignment.save();

    const populated = await LearningAssignment.findById(assignment._id)
      .populate("user_id", "name email")
      .populate("assigned_by", "name email");

    return res.status(200).json({ success: true, assignment: enrichAssignment(populated) });
  } catch (error) {
    return handleError(res, error);
  }
};

export const assignmentDelete = async (req, res) => {
  const { orgId, assignmentId } = req.params;
  try {
    await assertCanWriteOrg(orgId, req.user._id);
    const deleted = await LearningAssignment.findOneAndDelete({
      _id: assignmentId,
      organization_id: orgId,
    });
    if (!deleted) {
      return res.status(404).json({ message: "Assignment not found", success: false });
    }
    return res.status(200).json({ success: true, message: "Assignment removed" });
  } catch (error) {
    return handleError(res, error);
  }
};
