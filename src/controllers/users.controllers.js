import User from "../models/users.models.js";
export const userLogin = async (req, res) => {

    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).send({ message: "Email and password are required", success: false });
    }
    try {
        let user = await User.findOne({ email: email });

        // console.log(user);
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
        const accessToken = user.generateAccessToken();
        const refreshToken = user.generateRefreshToken();
        res.send({
            message: "User logged in successfully",
            success: true,
            user: {
                id: user._id,
                email: user.email,
                username: user.username,
                role: user.role
            },
            accessToken: accessToken,
            refreshToken: refreshToken
        });
    } catch (err) {
        console.error(err);
        res.status(500).send({ message: 'Server error', success: false });
    }
}

export const userRegister = async (req, res) => {
    // Handle user registration
    const { username, email, password, fullName } = req.body;

    if (!username || !email || !password) {
        return res.status(400).send({ message: "Username, email and password are required", success: false });
    }

    try {
        const user = await User.findOne({ $or: [{ email: email }, { username: username }] });
        if (user) {
            return res.status(400).send({ message: "User already exists", success: false });
        }
        if (password.length < 6) {
            return res.status(400).send({ message: "Password must be at least 6 characters", success: false });
        }

        const usr = new User({
            username,
            email,
            password,
            fullName
        });

        await usr.save();

        res.status(201).send({
            message: "User registered successfully",
            success: true,
            user: {
                id: usr._id,
                email: usr.email,
                username: usr.username
            }
        });
    } catch (err) {
        console.error(err);
        res.status(500).send({ message: 'Server error', success: false });
    }
}
