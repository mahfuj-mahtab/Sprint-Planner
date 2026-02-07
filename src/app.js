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
const allowedOrigins = [
  "https://sprint-planner-frontend-rho.vercel.app",
  "https://www.weekwins.com",
  "https://weekwins.com",
  "http://localhost:5173"
];

app.use(cors({
  origin: function (origin, callback) {
    // allow server-to-server, Postman, curl
    if (!origin) return callback(null, true);

    if (allowedOrigins.includes(origin)) {
      callback(null, origin); // 👈 MUST return the SAME origin
    } else {
      callback(new Error("CORS not allowed"));
    }
  },
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true
}));
app.use('/api/v1/users', userrRouter);
app.use('/api/v1/org', orgRouter);
// Sample route
app.get('/', (req, res) => {
    res.send('Hello, World!');
});

// Start the server

export default app;