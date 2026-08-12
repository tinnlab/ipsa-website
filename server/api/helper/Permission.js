export default {
    async isAdmin(userId) {
        const user = await Meteor.users.findOneAsync(userId);
        
        if (!user) {
            throw new Meteor.Error("unauthorized", "User not found");
        }
        
        if (!user.profile?.roles?.includes("admin")) {
            throw new Meteor.Error("forbidden", "Admin role required");
        }
        
        return true;
    },
    
    checkAdmin(userId) {
        const user = Meteor.users.findOne(userId);
        
        if (!user) {
            throw new Meteor.Error("unauthorized", "User not found");
        }
        
        if (!user.profile?.roles?.includes("admin")) {
            throw new Meteor.Error("forbidden", "Admin role required");
        }
        
        return true;
    }
}
