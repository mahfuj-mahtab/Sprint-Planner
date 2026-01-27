import User from "../models/users.models.js";
import jwt from "jsonwebtoken";

export const authenticateToken = (req, res, next) => {
    const token = req.header('Authorization')?.replace('Bearer ',"")
    console.log(token)
    if (!token) {
        return res.status(401).send({ message: "Access token is missing", success: false });
    }

    const user_info = jwt.verify(token, process.env.JWT_SECRET);
    // const user = User.findById(user_info.id).select('-password');
    req.user = {
        _id: user_info.id,
        email: user_info.email,
        username: user_info.username
    };
    next();

};