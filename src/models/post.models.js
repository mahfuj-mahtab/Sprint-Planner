import mongoose from 'mongoose';

const postSchema = new mongoose.Schema({
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
    },
    priority: {
        type: String,
        enum: ['Low', 'Medium', 'High'],
        default: 'Medium',
    },
    postingDate: {
        type: Date,
    },
    sprint_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Sprint',
    },
    organization_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Organization',
        required: true,
    },
    platformId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Platform',
        required: true,
    },
}, { timestamps: true });

const Post = mongoose.model('Post', postSchema);

export default Post;