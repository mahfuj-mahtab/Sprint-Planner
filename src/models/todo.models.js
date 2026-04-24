import mongoose from 'mongoose';

const todoSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true,
    },
    title: {
        type: String,
        required: true,
        trim: true,
    },
    description: {
        type: String,
        trim: true,
        default: '',
    },
    startDateTime: {
        type: Date,
        required: true,
    },
    endDateTime: {
        type: Date,
        required: true,
    },
    estimatedHours: {
        type: Number,
        required: true,
        min: 0.25,
        max: 24,
    },
    status: {
        type: String,
        enum: ['pending', 'in-progress', 'completed', 'cancelled'],
        default: 'pending',
    },
    priority: {
        type: String,
        enum: ['low', 'medium', 'high'],
        default: 'medium',
    },
    isOverdue: {
        type: Boolean,
        default: false,
    },
}, { timestamps: true });

// Index for efficient querying of user's todos
todoSchema.index({ userId: 1, startDateTime: 1 });
todoSchema.index({ userId: 1, isOverdue: 1, status: 1 });

// Virtual to calculate if task is overdue
todoSchema.virtual('dueWithinHours').get(function() {
    if (this.status === 'completed' || this.status === 'cancelled') {
        return null;
    }
    const now = new Date();
    const diffMs = this.endDateTime - now;
    return diffMs / (1000 * 60 * 60); // Convert to hours
});

// Pre-save middleware to check if overdue
todoSchema.pre('save', function() {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    
    // Mark as overdue if end time has passed and not completed/cancelled
    if (this.endDateTime < now && this.status !== 'completed' && this.status !== 'cancelled') {
        this.isOverdue = true;
    } else {
        this.isOverdue = false;
    }
    

});

export default mongoose.model('Todo', todoSchema);
