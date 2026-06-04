import mongoose from 'mongoose';
import { ALL_TASK_STATUSES, TASK_TYPES, TASK_PRIORITIES } from '../constants/taskWorkflow.js';

const taskSchema = new mongoose.Schema({
    title: {
        type: String,
        required: true,
        trim: true,
    },
    description: {
        type: String,
        trim: true,
    },
    status: {
        type: String,
        enum: ALL_TASK_STATUSES,
        default: 'Pending',
    },
    task_type: {
        type: String,
        enum: TASK_TYPES,
        default: 'feature',
    },
    priority: {
        type: String,
        enum: TASK_PRIORITIES,
        default: 'Medium',
    },
    blocked_reason: {
        type: String,
        trim: true,
        default: '',
    },
    acceptance_criteria: {
        type: String,
        trim: true,
        default: '',
    },
    startDate: {
        type: Date,
        default: Date.now,
    },
    endDate: {
        type: Date,
    },
    assignee: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
    }],
    sprint_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Sprint',
        index: true,
    },
    team_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Team',
        index: true,
    },
    project_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Project',
        index: true,
    },
    organization_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Organization',
        required: true,
        index: true,
    },
    feature_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Feature',
        index: true,
        default: null,
    },
}, { timestamps: true });

const Task = mongoose.model('Task', taskSchema);

export default Task;
