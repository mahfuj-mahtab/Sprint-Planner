import jwt from "jsonwebtoken";

export const authenticateToken = (req, res, next) => {
    const token = req.header('Authorization')?.replace('Bearer ', "");

    if (!token) {
        return res.status(401).json({ message: "Access token is missing", success: false });
    }

    // ✅ Use callback form so errors don't crash the server
    jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
        if (err?.name === 'TokenExpiredError') {
            // Axios interceptor catches this 401 and triggers the refresh flow
            return res.status(401).json({ message: "Token expired", success: false });
        }

        if (err) {
            // Tampered / invalid token — hard reject, no refresh attempt
            return res.status(403).json({ message: "Invalid token", success: false });
        }

        req.user = {
            _id: decoded.id,
            email: decoded.email,
            username: decoded.username,
            role: decoded.role,
        };

        next();
    });
};