import Organization from "../models/organization.models.js";
import Team from "../models/team.models.js";
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

        res.status(200).json({
            message: "Organization retrieved successfully",
            success: true,
            organization: org,
        });
    } catch (error) {
        res.status(500).json({ message: "Error retrieving organization", error, success: false });
    }

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