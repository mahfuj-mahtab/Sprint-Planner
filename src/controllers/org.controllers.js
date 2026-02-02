import Organization from "../models/organization.models.js";
import Team from "../models/team.models.js";
import Sprint from "../models/sprint.models.js";
import Task from "../models/task.models.js";
import User from "../models/users.models.js";
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
        const org = await Organization.findById(orgId).populate('members.user', '-password');
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
            user: member.user,
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

export const getSprintDetails = async (req, res) => {
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
        }).populate("members.user", "fullName email");

        // 3. Tasks of this sprint
        const tasks = await Task.find({
            sprint_id: sprintId,
        })
            .populate("assignee", "fullName email");

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

export const editSprintInOrg = async (req, res) => {
    const { orgId, sprintId } = req.params
    const org = await Organization.findById(orgId)
    if (!org) {
        return res.status(400).json({
            message: "Organizatin NOt found",
            success: false
        })
    }
    const isMember = org.owner_id.toString() === req.user._id
    if (!isMember) {
        return res.status(403).json({
            message: "You are not valid member",
            success: false
        })
    }
    const sprint = await Sprint.findById(sprintId)
    if (!sprint) {
        return res.status(404).json({
            message: "Sprint not found",
            success: false
        })
    }
    const { name, startDate, endDate, isActive } = req.body
    if (name) sprint.name = name
    if (startDate) sprint.startDate = startDate
    if (endDate) sprint.endDate = endDate
    if (typeof isActive === 'boolean') sprint.isActive = isActive
    await sprint.save()
    res.status(200).json({
        message: "Sprint updated successfully",
        success: true,
        sprint: sprint
    })
}

export const deleteSprint = async (req, res) => {
    const { orgId, sprintId } = req.params
    const org = Organization.findById(orgId)
    if (!org) {
        return res.status(403).json({
            message: "Org not found",
            success: false
        })
    }
    const sprint = await Sprint.findOne({
        _id: sprintId,
        organization_id: orgId
    });
    if (!sprint) {
        return res.status(404).json({
            message: "Sprint not found",
            success: false
        })
    }
    // await Sprint.findByIdAndDelete(sprintId)
    await sprint.deleteOne()
    res.status(200).json({
        message: "Sprint deleted successfully",
        success: true
    })
}

export const orgTeamCreate = async (req, res) => {
    const { orgId } = req.params
    const org = await Organization.findById(orgId)
    if (!org) {
        return res.status(403).json({
            message: "Org not found",
            success: false
        })
    }
    const { name } = req.body
    if (!name) {
        return res.status(400).json({
            message: "Team name is required",
            success: false
        })
    }
    const isMember = org.owner_id.toString() === req.user._id
    if (!isMember) {
        return res.status(403).json({
            message: "You are not authorized to add team to this organization",
            success: false
        })
    }
    const newTeam = new Team({
        name: name,
        organization_id: orgId
    })
    // for(const member of members){
    //     newTeam.members.push({
    //         user:member.user,
    //         role:member.role
    //     })
    // }
    await newTeam.save()
    res.status(201).json({
        message: "Team created successfully",
        success: true,
        team: newTeam
    })
}
export const orgTeamDelete = async (req, res) => {
    const { orgId, teamId } = req.params
    const org = await Organization.findById(orgId)
    if (!org) {
        return res.status(403).json({
            message: "Org not found",
            success: false
        })
    }

    const isMember = org.owner_id.toString() === req.user._id
    if (!isMember) {
        return res.status(403).json({
            message: "You are not authorized to add team to this organization",
            success: false
        })
    }
    const team = await Team.findOneAndDelete({
        _id: teamId,
        organization_id: orgId
    })
    if (!team) {
        return res.status(404).json({
            message: "Team not found",
            success: false
        })
    }
    // for(const member of members){
    //     newTeam.members.push({
    //         user:member.user,
    //         role:member.role
    //     })
    // }
    // await newTeam.save()
    res.status(201).json({
        message: "Team deleted successfully",
        success: true,
        // team: newTeam
    })
}
export const orgMemberAddToTeam = async (req, res) => {
    const { orgId, teamId } = req.params
    // const {memberId,role} = req.body
    const org = await Organization.findById(orgId)
    if (!org) {
        return res.status(403).json({
            message: "Organization not found",
            success: false
        })
    }
    const team = await Team.findOne({
        organization_id: orgId,
        _id: teamId
    })
    if (!team) {
        return res.status(403).json({
            message: "Team not found",
            success: false
        })
    }
    const isMember = org.owner_id.toString() === req.user._id
    if (!isMember) {
        return res.status(403).json({
            message: "You are not authorized to view teams of this organization",
            success: false
        })
    }
    const { user, role } = req.body
    const usr = await User.findById(user)
    if (!usr) {
        return res.status(403).json({
            message: "User is not valid",
            success: false
        })
    }
    const orgMember = org.members.some(m => m.user.toString() === user)
    if (!orgMember) {
        return res.status(403).json({
            message: "Member is not a valid member for this organization",
            success: false
        })
    }
    const isAlreadyMember = team.members.some(m => m.user.toString() === user)
    if (isAlreadyMember) {
        return res.status(400).json({
            message: "Member is already in the team",
            success: false
        })
    }
    team.members.push({
        user: user,
        role: role
    })
    await team.save()
    res.status(200).json({
        message: "Member added to team",
        success: true,
        team: team
    })
}
export const orgMemberRemoveFromTeam = async (req, res) => {
    const { orgId, teamId, memberId } = req.params
    // const {memberId,role} = req.body
    const org = await Organization.findById(orgId)
    if (!org) {
        return res.status(403).json({
            message: "Organization not found",
            success: false
        })
    }
    const team = await Team.findOne({
        organization_id: orgId,
        _id: teamId
    })
    if (!team) {
        return res.status(403).json({
            message: "Team not found",
            success: false
        })
    }
    const isMember = org.owner_id.toString() === req.user._id
    if (!isMember) {
        return res.status(403).json({
            message: "You are not authorized to view teams of this organization",
            success: false
        })
    }
    // const { user, role } = req.body
    const usr = await User.findById(memberId)
    if (!usr) {
        return res.status(403).json({
            message: "User is not valid",
            success: false
        })
    }
    const orgMember = org.members.some(m => m.user.toString() === memberId)
    if (!orgMember) {
        return res.status(403).json({
            message: "Member is not a valid member for this organization",
            success: false
        })
    }
    const isMemberInTeam = team.members.some(m => m.user.toString() === memberId)
    if (!isMemberInTeam) {
        return res.status(400).json({
            message: "Member is not in the team",
            success: false
        })
    }
    team.members = team.members.filter(m => m.user.toString() !== memberId)
    await team.save()
    res.status(200).json({
        message: "Member removed from team",
        success: true,
        team: team
    })
}
export const orgTeamFetchAll = async (req, res) => {
    const { orgId } = req.params
    const org = await Organization.findById(orgId)
    if (!org) {
        return res.status(403).json({
            message: "Org not found",
            success: false
        })
    }
    const isMember = org.owner_id.toString() === req.user._id
    if (!isMember) {
        return res.status(403).json({
            message: "You are not authorized to view teams of this organization",
            success: false
        })
    }
    const teams = await Team.find({ organization_id: orgId }).populate('members.user', '-password')
    res.status(200).json({
        message: "Teams fetched successfully",
        success: true,
        teams: teams
    })
}
export const orgTeamFetchOne = async (req, res) => {
    const { orgId, teamId } = req.params
    const org = await Organization.findById(orgId)
    if (!org) {
        return res.status(403).json({
            message: "Org not found",
            success: false
        })
    }
    const isMember = org.owner_id.toString() === req.user._id
    if (!isMember) {
        return res.status(403).json({
            message: "You are not authorized to view teams of this organization",
            success: false
        })
    }
    const team = await Team.findOne({ _id: teamId, organization_id: orgId }).populate('members.user', '-password')
    if (!team) {
        return res.status(404).json({
            message: "Team not found",
            success: false
        })
    }
    res.status(200).json({
        message: "Team fetched successfully",
        success: true,
        team: team
    })
}
export const orgAddTaskToTeamInSprint = async (req, res) => {
    const { orgId, sprintId } = req.params
    const { team, name, description, status, priority, startDate, endDate, members } = req.body
    const org = await Organization.findById(orgId)
    if (!org) {
        return res.status(403).json({
            message: "Org not found",
            success: false
        })
    }
    const isMember = org.owner_id.toString() === req.user._id
    if (!isMember) {
        return res.status(403).json({
            message: "You are not authorized to add task to this organization",
            success: false
        })
    }
    const sprint = await Sprint.findOne({ _id: sprintId, organization_id: orgId })
    if (!sprint) {
        return res.status(404).json({
            message: "Sprint not found",
            success: false
        })
    }
    const teamObj = await Team.findOne({
        _id: team,
        organization_id: orgId
    }).populate('members.user', '-password')
    if (!teamObj) {
        return res.status(404).json({
            message: "Team not found",
            success: false
        })
    }
    for (const member of members) {
        const isMemberInTeam = teamObj.members.some(mem => mem.user._id.toString() === member)
        if (!isMemberInTeam) {
            return res.status(400).json({
                message: `Member with id ${member} is not in the team`,
                success: false
            })
        }
    }
    const newTask = new Task({
        title: name,
        description,
        status,
        priority,
        startDate,
        endDate,
        sprint_id: sprintId,
        team_id: team,
        organization_id: orgId
    })
    for (const member of members) {
        newTask.assignee.push(member)
    }
    await newTask.save()
    res.status(201).json({
        message: "Task added to team in sprint successfully",
        success: true,
        task: newTask
    })
}
export const orgShowSingleTaskInSprint = async (req, res) => {
    const { orgId, sprintId, taskId } = req.params
    const org = await Organization.findById(orgId)
    if (!org) {
        return res.status(403).json({
            message: "Org not found",
            success: false
        })
    }
    const isMember = org.owner_id.toString() === req.user._id
    if (!isMember) {
        return res.status(403).json({
            message: "You are not authorized to view task of this organization",
            success: false
        })
    }
    const sprint = await Sprint.findOne({ _id: sprintId, organization_id: orgId })
    if (!sprint) {
        return res.status(404).json({
            message: "Sprint not found",
            success: false
        })
    }
    const task = await Task.findOne({
        _id: taskId,
        sprint_id: sprintId,
        organization_id: orgId
    }).populate('assignee', '-password').populate('team_id', '-organization_id')
    if (!task) {
        return res.status(404).json({
            message: "Task not found",
            success: false
        })
    }
    res.status(200).json({
        message: "Task fetched successfully",
        success: true,
        task: task
    })
}
export const orgEditTaskToTeamInSprint = async (req, res) => {
    const { orgId, sprintId, taskId } = req.params
    const { team, name, description, status, priority, startDate, endDate, members } = req.body
    const org = await Organization.findById(orgId)
    if (!org) {
        return res.status(403).json({
            message: "Org not found",
            success: false
        })
    }
    const isMember = org.owner_id.toString() === req.user._id
    if (!isMember) {
        return res.status(403).json({
            message: "You are not authorized to add task to this organization",
            success: false
        })
    }
    const sprint = await Sprint.findOne({ _id: sprintId, organization_id: orgId })
    if (!sprint) {
        return res.status(404).json({
            message: "Sprint not found",
            success: false
        })
    }
    const teamObj = await Team.findOne({
        _id: team,
        organization_id: orgId
    }).populate('members.user', '-password')
    if (!teamObj) {
        return res.status(404).json({
            message: "Team not found",
            success: false
        })
    }
    for (const member of members) {
        const isMemberInTeam = teamObj.members.some(mem => mem.user._id.toString() === member)
        if (!isMemberInTeam) {
            return res.status(400).json({
                message: `Member with id ${member} is not in the team`,
                success: false
            })
        }
    }
    const task = await Task.findOne({
        _id: taskId,
        sprint_id: sprintId,
        team_id: team,
        organization_id: orgId
    })
    if (!task) {
        return res.status(404).json({
            message: "Task not found",
            success: false
        })
    }
    task.title = name || task.title
    task.description = description || task.description
    task.status = status || task.status
    task.priority = priority || task.priority
    task.startDate = startDate || task.startDate
    task.endDate = endDate || task.endDate
    task.assignee = []
    for (const member of members) {
        task.assignee.push(member)
    }
    await task.save()
    res.status(201).json({
        message: "Task edited successfully",
        success: true,
        task: task
    })
}
export const orgDeleteTaskFromTeamInSprint = async (req, res) => {
    const { orgId, sprintId, taskId, teamId } = req.params
    // const { team, name, description, status, priority, startDate, endDate, members } = req.body
    const org = await Organization.findById(orgId)
    if (!org) {
        return res.status(403).json({
            message: "Org not found",
            success: false
        })
    }
    const isMember = org.owner_id.toString() === req.user._id
    if (!isMember) {
        return res.status(403).json({
            message: "You are not authorized to add task to this organization",
            success: false
        })
    }
    const sprint = await Sprint.findOne({ _id: sprintId, organization_id: orgId })
    if (!sprint) {
        return res.status(404).json({
            message: "Sprint not found",
            success: false
        })
    }
    const teamObj = await Team.findOne({
        _id: teamId,
        organization_id: orgId
    }).populate('members.user', '-password')
    if (!teamObj) {
        return res.status(404).json({
            message: "Team not found",
            success: false
        })
    }
    const actionValid = teamObj.members.some(mem => mem.user._id.toString() === req.user._id && (mem.role === 'admin' || mem.role === 'editor')) || org.owner_id.toString() === req.user._id
    if (!actionValid) {
        return res.status(403).json({
            message: "You are not authorized to delete task from this team",
            success: false
        })
    }
    const task = await Task.findOne({
        _id: taskId,
        sprint_id: sprintId,
        team_id: teamId,
        organization_id: orgId
    })
    if (!task) {
        return res.status(404).json({
            message: "Task not found",
            success: false
        })
    }
    await task.deleteOne()
    res.status(201).json({
        message: "Task deleted from team in sprint successfully",
        success: true,
        // task: task
    })
}