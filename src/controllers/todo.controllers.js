import Todo from '../models/todo.models.js';

// Constants for time calculation
const HOURS_IN_DAY = 24;
const SLEEP_HOURS = 8;
const BUFFER_HOURS = 4;
const AVAILABLE_HOURS_PER_DAY = HOURS_IN_DAY - SLEEP_HOURS - BUFFER_HOURS; // 12 hours

// Helper function to get start and end of a day
const getDayBoundaries = (date) => {
    const start = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0);
    const end = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59);
    return { start, end };
};

// Get start/end boundaries for a user's local day, expressed as UTC Date objects.
// tzOffset is minutes ahead of UTC (e.g. Dhaka UTC+6 → 360).
const getUtcDayBoundariesForLocalDay = ({ tzOffset, localY, localM, localD }) => {
    const offsetMs = (parseInt(tzOffset, 10) || 0) * 60000;
    const startUtc = new Date(Date.UTC(localY, localM, localD, 0, 0, 0, 0) - offsetMs);
    const endUtc = new Date(Date.UTC(localY, localM, localD, 23, 59, 59, 999) - offsetMs);
    return { start: startUtc, end: endUtc };
};

const getUtcDayBoundariesFromTzOffsetNow = (tzOffset) => {
    const offsetMs = (parseInt(tzOffset, 10) || 0) * 60000;
    const pseudoLocalNow = new Date(Date.now() + offsetMs);
    return getUtcDayBoundariesForLocalDay({
        tzOffset,
        localY: pseudoLocalNow.getUTCFullYear(),
        localM: pseudoLocalNow.getUTCMonth(),
        localD: pseudoLocalNow.getUTCDate(),
    });
};

const parseLocalDateYMD = (dateStr) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr || "");
    if (!m) return null;
    return { y: Number(m[1]), m: Number(m[2]) - 1, d: Number(m[3]) };
};

// Helper function to calculate total hours used for a specific day
const calculateDayHours = async (userId, targetDateOrBoundaries) => {
    const { start, end } = targetDateOrBoundaries?.start && targetDateOrBoundaries?.end
        ? targetDateOrBoundaries
        : getDayBoundaries(targetDateOrBoundaries);

    const todos = await Todo.find({
        userId,
        startDateTime: { $gte: start, $lte: end },
        status: { $ne: 'cancelled' }
    });

    const totalHours = todos.reduce((sum, todo) => sum + todo.estimatedHours, 0);
    return {
        totalHours,
        availableHours: AVAILABLE_HOURS_PER_DAY,
        remainingHours: AVAILABLE_HOURS_PER_DAY - totalHours,
        isOverloaded: totalHours > AVAILABLE_HOURS_PER_DAY,
        todos
    };
};

// Create a new todo
export const createTodo = async (req, res) => {
    try {
        const { title, description, startDateTime, endDateTime, estimatedHours, priority } = req.body;
        const userId = req.user._id;

        // Validation
        if (!title || !startDateTime || !endDateTime || !estimatedHours) {
            return res.status(400).json({
                success: false,
                message: 'Title, startDateTime, endDateTime, and estimatedHours are required'
            });
        }

        const start = new Date(startDateTime);
        const end = new Date(endDateTime);

        if (start >= end) {
            return res.status(400).json({
                success: false,
                message: 'Start date/time must be before end date/time'
            });
        }

        if (estimatedHours <= 0 || estimatedHours > 24) {
            return res.status(400).json({
                success: false,
                message: 'Estimated hours must be between 0.25 and 24'
            });
        }

        // Check if adding this todo would overload the day
        const dayAnalysis = await calculateDayHours(userId, start);
        const newTotalHours = dayAnalysis.totalHours + estimatedHours;

        const response = {
            dayAnalysis: {
                totalHoursAfterAdd: newTotalHours,
                availableHours: AVAILABLE_HOURS_PER_DAY,
                remainingHours: Math.max(0, AVAILABLE_HOURS_PER_DAY - newTotalHours),
                isOverloaded: newTotalHours > AVAILABLE_HOURS_PER_DAY,
                excessHours: newTotalHours > AVAILABLE_HOURS_PER_DAY ? newTotalHours - AVAILABLE_HOURS_PER_DAY : 0
            }
        };

        // Create the todo regardless, but warn about overload
        const todo = new Todo({
            userId,
            title,
            description: description || '',
            startDateTime: start,
            endDateTime: end,
            estimatedHours,
            priority: priority || 'medium'
        });

        await todo.save();

        res.status(201).json({
            success: true,
            message: response.dayAnalysis.isOverloaded
                ? `Todo created! Warning: You've allocated ${newTotalHours.toFixed(1)} hours on this day. You only have ${AVAILABLE_HOURS_PER_DAY} hours available.`
                : 'Todo created successfully',
            todo,
            warning: response.dayAnalysis.isOverloaded ? response.dayAnalysis : null
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// Get all todos for a user for today
export const getTodayTodos = async (req, res) => {
    try {
        const userId = req.user._id;
        const tzOffset = parseInt(req.query.tzOffset) || 0;
        const { start, end } = getUtcDayBoundariesFromTzOffsetNow(tzOffset);

        const todos = await Todo.find({
            userId,
            startDateTime: { $gte: start, $lte: end }
        }).sort({ isOverdue: -1, endDateTime: 1 });

        const analysis = await calculateDayHours(userId, { start, end });

        res.status(200).json({
            success: true,
            todos,
            analysis: {
                totalHours: analysis.totalHours,
                availableHours: analysis.availableHours,
                remainingHours: analysis.remainingHours,
                isOverloaded: analysis.isOverloaded,
                excessHours: analysis.isOverloaded ? analysis.totalHours - AVAILABLE_HOURS_PER_DAY : 0
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// Get todos for a specific date
export const getTodosByDate = async (req, res) => {
    try {
        const userId = req.user._id;
        const { date, tzOffset } = req.query;

        if (!date) {
            return res.status(400).json({
                success: false,
                message: 'Date query parameter is required'
            });
        }

        const ymd = parseLocalDateYMD(date);
        if (!ymd) {
            return res.status(400).json({ success: false, message: "Invalid date format (expected YYYY-MM-DD)" });
        }
        const { start, end } = getUtcDayBoundariesForLocalDay({
            tzOffset: parseInt(tzOffset) || 0,
            localY: ymd.y,
            localM: ymd.m,
            localD: ymd.d
        });

        const todos = await Todo.find({
            userId,
            startDateTime: { $gte: start, $lte: end }
        }).sort({ isOverdue: -1, endDateTime: 1 });

        const analysis = await calculateDayHours(userId, { start, end });

        res.status(200).json({
            success: true,
            todos,
            analysis: {
                totalHours: analysis.totalHours,
                availableHours: analysis.availableHours,
                remainingHours: analysis.remainingHours,
                isOverloaded: analysis.isOverloaded,
                excessHours: analysis.isOverloaded ? analysis.totalHours - AVAILABLE_HOURS_PER_DAY : 0
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// Get overdue todos
export const getOverdueTodos = async (req, res) => {
    try {
        const userId = req.user._id;
        const now = new Date();

        const todos = await Todo.find({
            userId,
            endDateTime: { $lt: now },
            status: { $nin: ['completed', 'cancelled'] }
        }).sort({ endDateTime: 1 });

        res.status(200).json({
            success: true,
            todos
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// Update a todo
export const updateTodo = async (req, res) => {
    try {
        const { todoId } = req.params;
        const userId = req.user._id;
        const { title, description, startDateTime, endDateTime, estimatedHours, status, priority } = req.body;

        const todo = await Todo.findOne({ _id: todoId, userId });

        if (!todo) {
            return res.status(404).json({
                success: false,
                message: 'Todo not found'
            });
        }

        // Update fields
        if (title) todo.title = title;
        if (description !== undefined) todo.description = description;
        if (startDateTime) todo.startDateTime = new Date(startDateTime);
        if (endDateTime) todo.endDateTime = new Date(endDateTime);
        if (estimatedHours) todo.estimatedHours = estimatedHours;
        if (status) todo.status = status;
        if (priority) todo.priority = priority;

        // Validate
        if (todo.startDateTime >= todo.endDateTime) {
            return res.status(400).json({
                success: false,
                message: 'Start date/time must be before end date/time'
            });
        }

        await todo.save();

        // Get analysis after update
        const analysis = await calculateDayHours(userId, todo.startDateTime);

        res.status(200).json({
            success: true,
            message: 'Todo updated successfully',
            todo,
            warning: analysis.isOverloaded ? {
                totalHours: analysis.totalHours,
                availableHours: analysis.availableHours,
                isOverloaded: true,
                excessHours: analysis.totalHours - AVAILABLE_HOURS_PER_DAY
            } : null
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// Delete a todo
export const deleteTodo = async (req, res) => {
    try {
        const { todoId } = req.params;
        const userId = req.user._id;

        const todo = await Todo.findOneAndDelete({ _id: todoId, userId });

        if (!todo) {
            return res.status(404).json({
                success: false,
                message: 'Todo not found'
            });
        }

        res.status(200).json({
            success: true,
            message: 'Todo deleted successfully'
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// Get time analysis for a day
export const getDayAnalysis = async (req, res) => {
    try {
        const userId = req.user._id;
        const { date, tzOffset } = req.query;
        const offset = parseInt(tzOffset) || 0;

        const boundaries = date
            ? (() => {
                const ymd = parseLocalDateYMD(date);
                if (!ymd) return null;
                return getUtcDayBoundariesForLocalDay({ tzOffset: offset, localY: ymd.y, localM: ymd.m, localD: ymd.d });
            })()
            : getUtcDayBoundariesFromTzOffsetNow(offset);

        if (!boundaries) {
            return res.status(400).json({ success: false, message: "Invalid date format (expected YYYY-MM-DD)" });
        }

        const analysis = await calculateDayHours(userId, boundaries);

        res.status(200).json({
            success: true,
            analysis: {
                totalHours: analysis.totalHours,
                availableHours: analysis.availableHours,
                remainingHours: analysis.remainingHours,
                isOverloaded: analysis.isOverloaded,
                excessHours: analysis.isOverloaded ? analysis.totalHours - AVAILABLE_HOURS_PER_DAY : 0,
                sleepHours: SLEEP_HOURS,
                bufferHours: BUFFER_HOURS,
                totalDayHours: HOURS_IN_DAY
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
