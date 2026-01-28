import Organization from "../models/organization.models.js";
import Team from "../models/team.models.js";
import Sprint from "../models/sprint.models.js";
import Task from "../models/task.models.js";
export const orgCreate = async (req, res) => {
    const { name, description } = req.body;
    // console.log(req.user.id)
    const owner_id = req.user._id
    if (!name || !description) {
        return res.status(400).json({ message: "Name and description are required", success: false });
    }
    try {
        const newOrg = new Organization({ name, description, owner_id });
        await newOrg.save();
        res.status(201).json({
            message: "Organization created successfully",
            success: true,
            organization: newOrg,

        });
    } catch (error) {
        res.status(500).json({ message: "Error creating organization", error, success: false });
    };

}

export const orgEdit = async (req, res) => {
    const { orgId } = req.params;
    const { name, description } = req.body;

    if (!name && !description) {
        return res.status(400).json({ message: "At least one field (name or description) is required to update", success: false });
    }

    try {
        const org = await Organization.findById(orgId);
        if (!org) {
            return res.status(404).json({ message: "Organization not found", success: false });
        }

        if (org.owner_id.toString() !== req.user._id) {
            return res.status(403).json({ message: "You do not have permission to edit this organization", success: false });
        }

        if (name) org.name = name;
        if (description) org.description = description;

        await org.save();
        res.status(200).json({
            message: "Organization updated successfully",
            success: true,
            organization: org,
        });
    } catch (error) {
        res.status(500).json({ message: "Error updating organization", error, success: false });
    }
}

export const orgDelete = async (req, res) => {
    const { orgId } = req.params;

    try {
        const org = await Organization.findById(orgId);
        if (!org) {
            return res.status(404).json({ message: "Organization not found", success: false });
        }
        if (org.owner_id.toString() !== req.user._id) {
            return res.status(403).json({ message: "You do not have permission to delete this organization", success: false });
        }

        await Organization.findByIdAndDelete(orgId);
        res.status(200).json({
            message: "Organization deleted successfully",
            success: true,
        });
    } catch (error) {
        res.status(500).json({ message: "Error deleting organization", error, success: false });
    }
}

export const orgGet = async (req, res) => {
    const { orgId } = req.params;

    try {
        const org = await Organization.findById(orgId);
        if (!org) {
            return res.status(404).json({ message: "Organization not found", success: false });
        }
        const sprints = await Sprint.find({ organization_id: orgId });
        res.status(200).json({
            message: "Organization retrieved successfully",
            success: true,
            organization: org,
            sprints: sprints
        });
    } catch (error) {
        res.status(500).json({ message: "Error retrieving organization", error, success: false });
    }

}
export const orgMemberAdd = async (req, res) => {
    const { orgId } = req.params
    const userId = req.user._id
    const { memberId } = req.body
    const org = await Organization.findById(orgId)
    if (!org) {
        return res.status(404).json({
            message: "Organization not found",
            success: false
        });
    }
    if (org.owner_id.toString() !== userId) {
        return res.status(403).json({
            message: "You do not have permission to add members to this organization",
            success: false
        })
    }
    const isMemberAlready = org.members.find(member => member.user.toString() === memberId)
    if (isMemberAlready) {
        return res.status(400).json({
            message: "User is already a member of this organization",
            success: false
        })
    }
    org.members.push({ user: memberId, status: 'active' })
    await org.save()
    res.status(200).json({
        message: "Member added to organization successfully",
        success: true,
        organization: org
    })


}
export const orgFetchAllMembers = async (req, res) => {
    const { orgId } = req.params
    const org = await Organization.findById(orgId).populate('members.user', '-password')
    if (!org) {
        return res.status(404).json({
            message: "Organization not found",
            success: false
        });

    }
    res.status(200).json({
        message: "Organization members fetched successfully",
        success: true,
        members: org.members
    })
}

export const addTeamToOrg = async (req, res) => {
    const { orgId } = req.params
    const { teamName, members } = req.body
    const org = await Organization.findById(orgId)
    if (!org) {
        return res.status(404).json({
            message: "Organization not found",
            success: false
        });
    }
    if (org.owner_id.toString() !== req.user._id) {
        return res.status(403).json({
            message: "You do not have permission to add team to this organization",
            success: false
        })
    }
    const newTeam = new Team({
        name: teamName,
        organization_id: orgId
    })
    for (const member of members) {
        newTeam.members.push({
            user: member.userId,
            role: member.role
        })
    }
    await newTeam.save()
    res.status(201).json({
        message: "Team added to organization successfully",
        success: true,
        team: newTeam
    })
}
// export const getSprintWithTeamsAndTasks = async (req, res) => {
//     try {
//         const { sprintId } = req.params;

//         if (!mongoose.Types.ObjectId.isValid(sprintId)) {
//             return res.status(400).json({ message: "Invalid sprint id" });
//         }

//         const sprint = await Sprint.findById(sprintId).lean();

//         if (!sprint) {
//             return res.status(404).json({ message: "Sprint not found" });
//         }

//         // Fetch teams with tasks of this sprint
//         const teams = await Team.aggregate([
//             {
//                 $match: {
//                     organization_id: sprint.organization_id,
//                 },
//             },
//             {
//                 $lookup: {
//                     from: "tasks",
//                     let: { teamId: "$_id" },
//                     pipeline: [
//                         {
//                             $match: {
//                                 $expr: {
//                                     $and: [
//                                         { $eq: ["$team_id", "$$teamId"] },
//                                         { $eq: ["$sprint_id", new mongoose.Types.ObjectId(sprintId)] },
//                                     ],
//                                 },
//                             },
//                         },
//                         {
//                             $populate: {
//                                 path: "assignee",
//                                 select: "name email",
//                             },
//                         },
//                     ],
//                     as: "tasks",
//                 },
//             },
//         ]);

//         return res.status(200).json({
//             sprint,
//             teams,
//         });
//     } catch (error) {
//         console.error("Error fetching sprint data:", error);
//         return res.status(500).json({ message: "Server error" });
//     }
// };

export const getSprintDetailsEasy = async (req, res) => {
    try {
        const { sprintId } = req.params;

        // 1. Sprint
        const sprint = await Sprint.findById(sprintId);
        if (!sprint) {
            return res.status(404).json({ message: "Sprint not found" });
        }

        // 2. Teams of same org
        const teams = await Team.find({
            organization_id: sprint.organization_id,
        });

        // 3. Tasks of this sprint
        const tasks = await Task.find({
            sprint_id: sprintId,
        })
            .populate("assignee", "name email");

        // 4. Attach tasks to teams (JS mapping)
        const teamsWithTasks = teams.map(team => ({
            ...team.toObject(),
            tasks: tasks.filter(
                task => task.team_id?.toString() === team._id.toString()
            ),
        }));

        res.status(200).json({
            sprint,
            teams: teamsWithTasks,
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Server error" });
    }
};

export const addSprintToOrg = async (req, res) => {
    const { orgId } = req.params
    const org = await Organization.findById(orgId).populate('members.user', '-password')
    if (!org) {
        return res.status(400).json({
            message: "Organizatin NOt found",
            success: false
        })
    }
    //    org.members.find(member=>member.user.toString() === req.user._id) || 
    const isMember = org.owner_id.toString() === req.user._id
    if (!isMember) {
        return res.status(403).json({
            message: "You are not valid member",
            success: false
        })
    }
    const { name, startDate, endDate } = req.body
    if (!name || !startDate || !endDate) {
        return res.status(401).json({
            message: "Name start date and End Date are mandatory",
            success: false
        })
    }
    const sprint = new Sprint({
        name: name,
        startDate: startDate,
        endDate: endDate,
        organization_id: orgId
    })
    await sprint.save()
    res.status(201).json({
        message: "Sprint added successfully",
        success: true,
        sprint: sprint
    })
}