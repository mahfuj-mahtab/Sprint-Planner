import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
const userSchema = new mongoose.Schema({
    username: {
        type: String,
        required: true,
        unique: true,
        trim: true,
    },
    email: {
        type: String,
        required: true,
        unique: true,
        trim: true,
        lowercase: true,
    },
    role: {
        type: String,
        enum: ['admin', 'user'],
        default: 'user',
    },
    password: {
        type: String,
        required: true,
    },
    fullName: {
        type: String,
        trim: true,
    },
}, { timestamps: true });

// Hash password before saving
userSchema.pre('save', async function () {
    if (!this.isModified('password')) {
        return;
    }
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
});

// Method to compare password
userSchema.methods.comparePassword = async function (candidatePassword) {
    return bcrypt.compare(candidatePassword, this.password);
};

userSchema.methods.generateAccessToken = function () {
    const payload = {
        id: this._id,
        username: this.username,
        role: this.role,
    };
    
    return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '24h' });
};

userSchema.methods.generateRefreshToken = function () {
    const payload = {
        id: this._id,
    };
    
    return jwt.sign(payload, process.env.REFRESH_TOKEN_SECRET, { expiresIn: '7d' });
};

const User = mongoose.model('User', userSchema);

export default User;