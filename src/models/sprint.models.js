import mongoose from "mongoose";
const sprintSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true,
    },
    startDate: {
        type: Date,
        required: true,
    },
    endDate: {
        type: Date,
        required: true,
    },
    organization_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Organization',
        required: true,
    },
    isActive : {
        type: Boolean,
        default: false,
    },
}, { timestamps: true });

const Sprint = mongoose.model('Sprint', sprintSchema);

export default Sprint;