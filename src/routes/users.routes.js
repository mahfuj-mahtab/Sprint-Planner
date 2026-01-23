import { Router } from "express";
import User from "../models/users.models.js";
const router = Router();



router.post("/login", async (req, res) => {
    // Handle user login
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).send({ message: "Email and password are required", success: false });
    }
    try {
        const user = await User.findOne({ email: email }).exec();
        console.log(user);
        if (!user) {
            return res.status(404).send({
                message: "User not found",
                success: false
            });
        }
        const isMatch = await user.comparePassword(password);
        if (!isMatch) {
            return res.status(401).send({
                message: "Invalid credentials",
                success: false
            });
        }
        res.send({
            message: "User logged in successfully",
            success: true,
            user: {
                id: user._id,
                email: user.email,
                username: user.username
            }
        });
    } catch (err) {
        console.error(err);
        res.status(500).send({ message: 'Server error', success: false });
    }
});

router.post("/register", (req, res) => {
    // Handle user registration
    res.send("User registration");
});

export default router;