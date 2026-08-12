import { Meteor } from 'meteor/meteor'

Meteor.publish({
    'organism.all'() {
        return DBCollections.Organism.find({ })
    },
    'organism.user.all'() {
        // The field is isEnabled — organism.add/organism.enable never write `enabled`, so this
        // published nothing at all.
        return DBCollections.Organism.find({ isEnabled: true})
    }
});
