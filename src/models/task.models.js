import mongoose from 'mongoose';

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
        enum: ['Pending', 'Work In Progress', 'Hold', 'Canceled', 'Completed'],
        default: 'Pending',
    },
    priority: {
        type: String,
        enum: ['Low', 'Medium', 'High'],
        default: 'Medium',
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
    },
    team_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Team',
    },
    organization_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Organization',
        required: true,
    },
}, { timestamps: true });

const Task = mongoose.model('Task', taskSchema);

export default Task;