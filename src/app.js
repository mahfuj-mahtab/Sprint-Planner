import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import connectDB from './config/db.js';
import 'dotenv/config';
import userrRouter from './routes/users.routes.js';
const app = express();
// dotenv.config();
// Connect to database
connectDB();
// Middleware
app.use(bodyParser.json());
app.use(cors());
app.use('/api/v1/users', userrRouter);
// Sample route
app.get('/', (req, res) => {
    res.send('Hello, World!');
});

// Start the server

export default app;