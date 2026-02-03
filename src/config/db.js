import mongoose from "mongoose";

const connectDB = async () => {
    try {
        const dbName = process.env.MONGODB_DBNAME || 'sprint_planner';
        const uri = `mongodb+srv://${encodeURIComponent(process.env.MONGODB_USERNAME)}:${encodeURIComponent(process.env.MONGODB_PASSWORD)}@cluster0.izfa076.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;
        await mongoose.connect(uri, { dbName });
        console.log('MongoDB connected successfully');
    } catch (error) {
        console.error('MongoDB connection failed:', error.message);
        process.exit(1);
    }
};

export default connectDB;