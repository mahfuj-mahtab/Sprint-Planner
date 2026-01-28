import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import connectDB from './config/db.js';
import 'dotenv/config';
import userrRouter from './routes/users.routes.js';
import orgRouter from './routes/org.routes.js';
const app = express();
// dotenv.config();
// Connect to database
connectDB();
// Middleware
app.use(bodyParser.json());
app.use(cors({
  origin: "http://localhost:5173",
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true // if using cookies or auth headers
}));
app.use('/api/v1/users', userrRouter);
app.use('/api/v1/org', orgRouter);
// Sample route
app.get('/', (req, res) => {
    res.send('Hello, World!');
});

// Start the server

export default app;