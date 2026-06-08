import mongoose from "mongoose";

const organizationSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true,
    },
    description: {
        type: String,
        trim: true,
    },
    owner_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
    },
    members: [{
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },
        role: {
            type: String,
            enum: ['admin', 'editor', 'viewer', 'client'],
            default: 'viewer',
        },
        /** When role is client — primary billing account (legacy / first). */
        client_account_id: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Client',
            default: null,
        },
        /** All billing accounts this portal user represents (middleman can have several). */
        client_account_ids: [{
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Client',
        }],
        status: {
            type: String,
            enum: ['active', 'pending', 'inactive','banned'],
            default: 'pending',
        },
    }],
}, { timestamps: true });

const Organization = mongoose.model('Organization', organizationSchema);

export default Organization;